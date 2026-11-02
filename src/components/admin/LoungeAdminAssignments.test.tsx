import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../services/loungeOperations', () => ({ loungeRequest: mocks.request }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: any) => values?.name ? `${key} ${values.name}` : key }) }));
import LoungeAdminAssignments from './LoungeAdminAssignments';
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('lounge administrator assignment controls', () => {
  it('adds this lounge without discarding another lounge assignment', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mocks.request.mockImplementation(action => Promise.resolve(action === 'list-lounge-admins'
      ? { admins: [{ id: 'admin', name: 'Alice', role: 'admin', storeIds: ['A'] }] } : { storeIds: ['A', 'B'] }));
    render(<LoungeAdminAssignments storeId="B" />);
    const toggle = await screen.findByRole('switch', { name: 'loungeOperations.assignAdmin Alice' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('assign-lounge-admin', {
      storeId: 'B', userId: 'admin', assigned: true, expectedStoreIds: ['A'],
    }));
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  });
});
