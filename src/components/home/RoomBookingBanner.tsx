import React, { useState } from 'react';

const fallbackImage = 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=600&q=80';

export const RoomBookingBanner: React.FC<{ imageUrl?: string | null; roomName?: string; title: string }> = ({ imageUrl, roomName, title }) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const showRoomImage = Boolean(imageUrl && imageUrl !== failedUrl);
  const showImage = showRoomImage || !fallbackFailed;
  const src = showRoomImage ? imageUrl! : fallbackImage;
  return (
    <div style={{ width: '100%', height: showImage ? 160 : 48, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
      {showImage && <img src={src} alt={showRoomImage ? roomName || title : title}
        onError={() => { if (showRoomImage) setFailedUrl(imageUrl!); else setFallbackFailed(true); }}
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px 8px 0 0' }} />}
      {showImage && <div style={{ position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.65) 100%)' }} />}
      <span style={{ position: 'absolute', bottom: 10, left: 16, right: 36, color: '#fff',
        fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere', textShadow: showImage ? '0 2px 4px rgba(0,0,0,0.8)' : undefined }}>{title}</span>
    </div>
  );
};
