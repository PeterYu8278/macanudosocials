package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"go.mau.fi/whatsmeow"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

var identifier = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`)
var phonePattern = regexp.MustCompile(`^\+[1-9][0-9]{6,14}$`)

type gateway struct {
	db                                               *sql.DB
	client                                           *whatsmeow.Client
	key                                              cipher.AEAD
	token, session, gatewayID, callback, callbackKey string
	mu                                               sync.Mutex
	qr                                               string
	qrUntil                                          time.Time
	pairing                                          bool
	lastPair                                         time.Time
}

func required(name string) string {
	v := os.Getenv(name)
	if v == "" {
		log.Fatalf("Missing %s", name)
	}
	return v
}

func newCipher(encoded string) (cipher.AEAD, error) {
	k, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(k) != 32 {
		return nil, errors.New("invalid encryption key")
	}
	b, err := aes.NewCipher(k)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(b)
}

func (g *gateway) seal(body []byte) []byte {
	nonce := make([]byte, g.key.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		panic(err)
	}
	return g.key.Seal(nonce, nonce, body, []byte(g.session))
}

func (g *gateway) open(body []byte) ([]byte, error) {
	n := g.key.NonceSize()
	if len(body) < n {
		return nil, errors.New("invalid ciphertext")
	}
	return g.key.Open(nil, body[:n], body[n:], []byte(g.session))
}

func digest(v []byte) string { h := sha256.Sum256(v); return hex.EncodeToString(h[:]) }
func reply(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (g *gateway) handler(w http.ResponseWriter, r *http.Request) {
	actual := sha256.Sum256([]byte(r.Header.Get("Authorization")))
	expected := sha256.Sum256([]byte("Bearer " + g.token))
	if subtle.ConstantTimeCompare(actual[:], expected[:]) != 1 {
		reply(w, 401, map[string]string{"code": "unauthorized"})
		return
	}
	if r.URL.Path == "/v1/status" && r.Method == "GET" {
		g.mu.Lock()
		defer g.mu.Unlock()
		state, account := "disconnected", ""
		if g.client.Store.ID != nil {
			account = "+" + g.client.Store.ID.User
		}
		if g.client.IsConnected() && g.client.IsLoggedIn() {
			state = "connected"
		}
		qr := ""
		if time.Now().Before(g.qrUntil) {
			qr = g.qr
			if qr != "" {
				state = "qr"
			}
		}
		reply(w, 200, map[string]any{"sessionId": g.session, "status": state, "account": account, "qr": qr, "qrExpiresAtMs": g.qrUntil.UnixMilli()})
		return
	}
	if r.URL.Path == "/v1/pair" && r.Method == "POST" {
		g.mu.Lock()
		if g.pairing || time.Since(g.lastPair) < time.Minute {
			g.mu.Unlock()
			reply(w, 409, map[string]string{"code": "connection-busy"})
			return
		}
		g.pairing = true
		g.lastPair = time.Now()
		g.mu.Unlock()
		go g.pair()
		reply(w, 202, map[string]string{"status": "connecting"})
		return
	}
	if r.URL.Path == "/v1/messages" && r.Method == "POST" {
		var input struct {
			RequestID string `json:"requestId"`
			Session   string `json:"sessionId"`
			Account   string `json:"account"`
			Phone     string `json:"phone"`
			Text      string `json:"text"`
			Expires   int64  `json:"expiresAtMs"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 16384)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF || !identifier.MatchString(input.RequestID) || input.Session != g.session || !phonePattern.MatchString(input.Phone) || len(input.Text) > 12000 || strings.TrimSpace(input.Text) == "" || input.Expires <= time.Now().UnixMilli() || input.Expires > time.Now().Add(time.Hour).UnixMilli() {
			reply(w, 400, map[string]string{"code": "invalid-request"})
			return
		}
		if g.client.Store.ID == nil || input.Account != "+"+g.client.Store.ID.User || !g.client.IsLoggedIn() {
			reply(w, 409, map[string]string{"code": "verification-required"})
			return
		}
		body, _ := json.Marshal(input)
		fingerprint := digest(body)
		id := g.client.GenerateMessageID()
		_, err := g.db.ExecContext(r.Context(), `INSERT INTO gateway_outbox (id,fingerprint,payload,message_id,account,expires_at,status) VALUES ($1,$2,$3,$4,$5,$6,'queued') ON CONFLICT(id) DO NOTHING`, input.RequestID, fingerprint, g.seal(body), id, input.Account, time.UnixMilli(input.Expires))
		var stored, status, messageID string
		if err == nil {
			err = g.db.QueryRowContext(r.Context(), `SELECT fingerprint,status,message_id FROM gateway_outbox WHERE id=$1`, input.RequestID).Scan(&stored, &status, &messageID)
		}
		if err != nil {
			reply(w, 503, map[string]string{"code": "service-unavailable"})
			return
		}
		if stored != fingerprint {
			reply(w, 409, map[string]string{"code": "request-conflict"})
			return
		}
		reply(w, 200, map[string]string{"status": status, "messageId": messageID})
		return
	}
	reply(w, 404, map[string]string{"code": "not-found"})
}

func (g *gateway) pair() {
	defer func() { g.mu.Lock(); g.pairing = false; g.mu.Unlock() }()
	if g.client.Store.ID != nil {
		if !g.client.IsConnected() {
			_ = g.client.Connect()
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	ch, err := g.client.GetQRChannel(ctx)
	if err != nil {
		return
	}
	if g.client.Connect() != nil {
		return
	}
	for item := range ch {
		g.mu.Lock()
		if item.Event == "code" {
			g.qr = item.Code
			g.qrUntil = time.Now().Add(item.Timeout)
		} else {
			g.qr = ""
			g.qrUntil = time.Time{}
		}
		g.mu.Unlock()
	}
}

func (g *gateway) event(v any) {
	if message, ok := v.(*events.Message); ok {
		if message.Info.IsFromMe || message.Info.IsGroup || message.Info.Chat.Server == types.BroadcastServer || message.Info.Timestamp.Before(time.Now().Add(-2*time.Minute)) {
			return
		}
		sender := message.Info.Sender.ToNonAD()
		if sender.Server == types.HiddenUserServer {
			if message.Info.SenderAlt.Server == types.DefaultUserServer {
				sender = message.Info.SenderAlt.ToNonAD()
			} else {
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				resolved, err := g.client.Store.LIDs.GetPNForLID(ctx, sender)
				cancel()
				if err != nil {
					return
				}
				sender = resolved.ToNonAD()
			}
		}
		phone := "+" + sender.User
		if sender.Server != types.DefaultUserServer || !phonePattern.MatchString(phone) {
			return
		}
		text := message.Message.GetConversation()
		if text == "" {
			text = message.Message.GetExtendedTextMessage().GetText()
		}
		if text == "" || len(text) > 500 {
			return
		}
		g.emit(map[string]any{"type": "message", "messageId": message.Info.ID, "phone": phone, "text": text, "statusAtMs": message.Info.Timestamp.UnixMilli()})
	}
	if receipt, ok := v.(*events.Receipt); ok {
		status := ""
		switch receipt.Type {
		case types.ReceiptTypeDelivered:
			status = "delivered"
		case types.ReceiptTypeRead:
			status = "read"
		}
		if status == "" {
			return
		}
		for _, id := range receipt.MessageIDs {
			g.emit(map[string]any{"type": "receipt", "messageId": id, "status": status, "statusAtMs": receipt.Timestamp.UnixMilli()})
		}
	}
}

func (g *gateway) emit(event map[string]any) {
	event["sessionId"] = g.session
	event["gatewayId"] = g.gatewayID
	body, _ := json.Marshal(event)
	id := digest(body)
	_, err := g.db.Exec(`INSERT INTO gateway_callbacks(id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, g.seal(body))
	if err != nil {
		log.Print("callback persist failed")
	}
}

func (g *gateway) work(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			g.sendOne(ctx)
			g.deliverOne(ctx)
		}
	}
}

func (g *gateway) sendOne(ctx context.Context) {
	var id, messageID, account string
	var body []byte
	var expires time.Time
	err := g.db.QueryRowContext(ctx, `SELECT id,payload,message_id,account,expires_at FROM gateway_outbox WHERE status='queued' ORDER BY created_at LIMIT 1`).Scan(&id, &body, &messageID, &account, &expires)
	if err != nil {
		return
	}
	status := "failed"
	if time.Now().Before(expires) {
		if !g.client.IsConnected() || !g.client.IsLoggedIn() {
			return
		}
		if g.client.Store.ID == nil || account != "+"+g.client.Store.ID.User {
			return
		}
		plain, err := g.open(body)
		var input struct{ Phone, Text string }
		if err != nil || json.Unmarshal(plain, &input) != nil {
			return
		}
		// Persist the provider ID and uncertain state BEFORE the external side effect.
		result, err := g.db.ExecContext(ctx, `UPDATE gateway_outbox SET status='submitting' WHERE id=$1 AND status='queued'`, id)
		if err != nil {
			return
		}
		n, _ := result.RowsAffected()
		if n != 1 {
			return
		}
		sendCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		_, err = g.client.SendMessage(sendCtx, types.NewJID(strings.TrimPrefix(input.Phone, "+"), types.DefaultUserServer), &waE2E.Message{Conversation: proto.String(input.Text)}, whatsmeow.SendRequestExtra{ID: messageID})
		cancel()
		status = "sent"
		if err != nil {
			status = "unknown"
		}
	}
	// The terminal state and callback are committed together, so a restart cannot lose an acknowledgement.
	finish, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := g.db.BeginTx(finish, nil)
	if err != nil {
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(finish, `UPDATE gateway_outbox SET status=$2,payload=NULL WHERE id=$1`, id, status); err != nil {
		return
	}
	event := map[string]any{"type": "submission", "gatewayId": g.gatewayID, "sessionId": g.session, "requestId": id, "messageId": messageID, "status": status, "statusAtMs": time.Now().UnixMilli()}
	payload, _ := json.Marshal(event)
	if _, err = tx.ExecContext(finish, `INSERT INTO gateway_callbacks(id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING`, digest(payload), g.seal(payload)); err != nil {
		return
	}
	_ = tx.Commit()
}

func signature(key, stamp, id string, body []byte) string {
	h := hmac.New(sha256.New, []byte(key))
	h.Write([]byte(stamp + "." + id + "."))
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil))
}

func (g *gateway) deliverOne(ctx context.Context) {
	var id string
	var encrypted []byte
	var attempts int
	err := g.db.QueryRowContext(ctx, `SELECT id,payload,attempts FROM gateway_callbacks WHERE next_at <= now() ORDER BY next_at LIMIT 1`).Scan(&id, &encrypted, &attempts)
	if err != nil {
		return
	}
	body, err := g.open(encrypted)
	if err != nil {
		return
	}
	var event struct {
		Type       string
		StatusAtMs int64
	}
	if json.Unmarshal(body, &event) != nil {
		return
	}
	if event.Type == "message" && event.StatusAtMs < time.Now().Add(-2*time.Minute).UnixMilli() {
		_, _ = g.db.ExecContext(ctx, `DELETE FROM gateway_callbacks WHERE id=$1`, id)
		return
	}
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	req, err := http.NewRequestWithContext(ctx, "POST", g.callback, strings.NewReader(string(body)))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Gateway-Timestamp", stamp)
	req.Header.Set("X-Gateway-Event", id)
	req.Header.Set("X-Gateway-Signature", signature(g.callbackKey, stamp, id, body))
	client := &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		response.Body.Close()
	}
	if err == nil && response.StatusCode >= 200 && response.StatusCode < 300 {
		_, _ = g.db.ExecContext(ctx, `DELETE FROM gateway_callbacks WHERE id=$1`, id)
		return
	}
	delay := time.Duration(1<<min(attempts, 10)) * time.Second
	_, _ = g.db.ExecContext(ctx, `UPDATE gateway_callbacks SET attempts=attempts+1,next_at=$2 WHERE id=$1`, id, time.Now().Add(delay))
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	g := &gateway{token: required("GATEWAY_API_TOKEN"), session: required("GATEWAY_SESSION_ID"), gatewayID: required("GATEWAY_ID"), callback: required("GATEWAY_CALLBACK_URL"), callbackKey: required("GATEWAY_CALLBACK_SECRET")}
	if len(g.token) < 32 || len(g.callbackKey) < 32 || !identifier.MatchString(g.session) {
		log.Fatal("Invalid gateway credentials")
	}
	u, err := url.Parse(g.callback)
	if err != nil || u.Scheme != "https" || u.User != nil {
		log.Fatal("Invalid HTTPS callback")
	}
	g.key, err = newCipher(required("GATEWAY_PAYLOAD_ENCRYPTION_KEY"))
	if err != nil {
		log.Fatal("Invalid encryption key")
	}
	g.db, err = sql.Open("pgx", required("DATABASE_URL"))
	if err != nil {
		log.Fatal("Database unavailable")
	}
	defer g.db.Close()
	// Session-level advisory lock on a dedicated connection: only one owner per database.
	lease, err := g.db.Conn(ctx)
	if err != nil {
		log.Fatal("Database unavailable")
	}
	defer lease.Close()
	var locked bool
	if lease.QueryRowContext(ctx, `SELECT pg_try_advisory_lock(849217412)`).Scan(&locked) != nil || !locked {
		log.Fatal("Gateway database already owned")
	}
	_, err = g.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS gateway_outbox(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload BYTEA,message_id TEXT NOT NULL,account TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()); CREATE TABLE IF NOT EXISTS gateway_callbacks(id TEXT PRIMARY KEY,payload BYTEA NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at TIMESTAMPTZ NOT NULL DEFAULT now());`)
	if err != nil {
		log.Fatal("Gateway schema unavailable")
	}
	_, err = g.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS gateway_identity(singleton BOOLEAN PRIMARY KEY CHECK(singleton),gateway_id TEXT NOT NULL,session_id TEXT NOT NULL,key_check BYTEA NOT NULL)`)
	if err != nil {
		log.Fatal("Gateway identity schema unavailable")
	}
	_, err = g.db.ExecContext(ctx, `INSERT INTO gateway_identity VALUES(true,$1,$2,$3) ON CONFLICT DO NOTHING`, g.gatewayID, g.session, g.seal([]byte("gateway-key-check")))
	if err != nil {
		log.Fatal("Gateway identity unavailable")
	}
	var savedGateway, savedSession string
	var keyCheck []byte
	err = g.db.QueryRowContext(ctx, `SELECT gateway_id,session_id,key_check FROM gateway_identity WHERE singleton=true`).Scan(&savedGateway, &savedSession, &keyCheck)
	plain, keyErr := g.open(keyCheck)
	if err != nil || savedGateway != g.gatewayID || savedSession != g.session || keyErr != nil || string(plain) != "gateway-key-check" {
		log.Fatal("Database identity or encryption key mismatch; restore the original configuration")
	}
	container := sqlstore.NewWithDB(g.db, "postgres", nil)
	if container.Upgrade(ctx) != nil {
		log.Fatal("Session schema unavailable")
	}
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		log.Fatal("Session unavailable")
	}
	g.client = whatsmeow.NewClient(device, nil)
	g.client.AutoReconnectHook = func(error) bool { return g.client.AutoReconnectErrors < 10 }
	g.client.AddEventHandler(g.event)
	rows, err := g.db.QueryContext(ctx, `UPDATE gateway_outbox SET status='unknown',payload=NULL WHERE status='submitting' RETURNING id,message_id`)
	if err != nil {
		log.Fatal("Outbox recovery failed")
	}
	type recovery struct{ id, message string }
	var recovered []recovery
	for rows.Next() {
		var item recovery
		if rows.Scan(&item.id, &item.message) == nil {
			recovered = append(recovered, item)
		}
	}
	rows.Close()
	for _, item := range recovered {
		g.emit(map[string]any{"type": "submission", "requestId": item.id, "messageId": item.message, "status": "unknown", "statusAtMs": time.Now().UnixMilli()})
	}
	if device.ID != nil {
		go func() { _ = g.client.Connect() }()
	}
	go g.work(ctx)
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				check, cancel := context.WithTimeout(ctx, 4*time.Second)
				err := lease.PingContext(check)
				cancel()
				if err != nil {
					stop()
					return
				}
			}
		}
	}()
	addr := os.Getenv("GATEWAY_LISTEN")
	if addr == "" {
		addr = ":8080"
	}
	server := &http.Server{Addr: addr, Handler: http.HandlerFunc(g.handler), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, MaxHeaderBytes: 8192}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Print("Gateway listener failed")
			stop()
		}
	}()
	fmt.Println("Gateway ready; authenticated management API enabled")
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
	g.client.Disconnect()
}
