import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RoomBookingBanner } from './RoomBookingBanner';

afterEach(cleanup);

describe('room booking photo', () => {
  it('shows the selected room photo and updates when switching rooms', () => {
    const { rerender } = render(<RoomBookingBanner imageUrl="https://example.com/one.jpg" roomName="Room One" title="Room Booking" />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://example.com/one.jpg');
    expect(screen.getByRole('img').getAttribute('alt')).toBe('Room One');
    rerender(<RoomBookingBanner imageUrl="https://example.com/two.jpg" roomName="Room Two" title="Room Booking" />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://example.com/two.jpg');
  });

  it('uses the landscape fallback when no room photo is configured', () => {
    render(<RoomBookingBanner imageUrl={null} title="Room Booking" />);
    expect(screen.getByRole('img').getAttribute('src')).toContain('images.unsplash.com');
    expect(screen.getByText('Room Booking')).toBeTruthy();
  });

  it('replaces failed room photos with the landscape and still shows another room photo', () => {
    const { rerender } = render(<RoomBookingBanner imageUrl="https://example.com/broken.jpg" title="Room Booking" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img').getAttribute('src')).toContain('images.unsplash.com');
    expect(screen.getByText('Room Booking')).toBeTruthy();
    rerender(<RoomBookingBanner imageUrl="https://example.com/working.jpg" title="Room Booking" />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://example.com/working.jpg');
  });

  it('keeps the title if even the landscape fails without repeatedly retrying it', () => {
    render(<RoomBookingBanner title="Room Booking" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Room Booking')).toBeTruthy();
  });
});
