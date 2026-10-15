package main

import (
	"encoding/base64"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEncryptionSessionBinding(t *testing.T) {
	k, err := newCipher(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	g := gateway{key: k, session: "pilot"}
	body := g.seal([]byte("private message"))
	if strings.Contains(string(body), "private message") {
		t.Fatal("plaintext persisted")
	}
	plain, err := g.open(body)
	if err != nil || string(plain) != "private message" {
		t.Fatal("roundtrip failed")
	}
	g.session = "other"
	if _, err := g.open(body); err == nil {
		t.Fatal("accepted another session")
	}
}

func TestAuthentication(t *testing.T) {
	g := gateway{token: strings.Repeat("a", 32)}
	for _, token := range []string{"", "Bearer bad"} {
		r := httptest.NewRequest("GET", "/v1/status", nil)
		r.Header.Set("Authorization", token)
		w := httptest.NewRecorder()
		g.handler(w, r)
		if w.Code != 401 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("unauthenticated request accepted")
		}
	}
}

func TestSignatureBindsBodyAndEvent(t *testing.T) {
	a := signature("key", "123", "event", []byte("body"))
	if a == signature("key", "123", "other", []byte("body")) || a == signature("key", "123", "event", []byte("changed")) {
		t.Fatal("invalid signature binding")
	}
}
