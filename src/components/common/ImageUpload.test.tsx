import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from 'antd';
import ImageUpload from './ImageUpload';

const mocks = vi.hoisted(() => ({ uploading: false, deleteResource: vi.fn(), upload: vi.fn() }));
vi.mock('../../hooks/useCloudinary', () => ({ useCloudinary: () => ({ upload: mocks.upload, uploading: mocks.uploading, error: null }) }));
vi.mock('../../services/cloudinary', () => ({ deleteResource: mocks.deleteResource, extractPublicIdFromUrl: () => 'rooms/photo' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./ImageCrop', () => ({ default: () => null }));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.uploading = false; });

describe('room photo upload safety', () => {
  it('removes the form URL without deleting the cloud asset when opted out', () => {
    const onChange = vi.fn();
    render(<App><ImageUpload value="https://example.com/photo.jpg" deleteFromCloudinary={false} onChange={onChange} /></App>);
    fireEvent.click(screen.getByRole('img', { name: 'delete' }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(mocks.deleteResource).not.toHaveBeenCalled();
    expect(screen.queryByText('upload.confirmDeleteImage')).toBeNull();
  });

  it('preserves the existing deletion confirmation by default', () => {
    const onChange = vi.fn();
    render(<App><ImageUpload value="https://example.com/photo.jpg" onChange={onChange} /></App>);
    fireEvent.click(screen.getByRole('img', { name: 'delete' }));
    expect(screen.getByText('upload.confirmDeleteImage')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports upload state so the room form can prevent saving unfinished uploads', () => {
    const onUploadingChange = vi.fn();
    const { rerender } = render(<App><ImageUpload onUploadingChange={onUploadingChange} /></App>);
    expect(onUploadingChange).toHaveBeenLastCalledWith(false);
    mocks.uploading = true;
    rerender(<App><ImageUpload onUploadingChange={onUploadingChange} /></App>);
    expect(onUploadingChange).toHaveBeenLastCalledWith(true);
  });
});
