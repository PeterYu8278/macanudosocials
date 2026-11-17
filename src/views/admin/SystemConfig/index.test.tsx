import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), store: { id: 'lounge', name: 'Test Lounge', status: 'active' } }));
vi.mock('react-i18next', async original => ({ ...await original<any>(), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../store/modules/auth', () => ({ useAuthStore: () => ({ user: { id: 'developer', role: 'developer' } }) }));
vi.mock('../../../hooks/useFirestoreQuery', () => ({ useFirestoreQuery: () => ({ data: [mocks.store], loading: false, refresh: mocks.refresh }) }));
vi.mock('../../../services/firebase/pointsConfig', () => ({ getPointsConfig: async () => ({ purchase: {} }), getDefaultPointsConfig: () => ({ purchase: {} }), updatePointsConfig: vi.fn() }));
vi.mock('../../../services/firebase/membershipFee', () => ({ getMembershipFeeConfig: async () => ({ annualFees: [] }), getDefaultMembershipFeeConfig: () => ({ annualFees: [] }), updateMembershipFeeConfig: vi.fn() }));
vi.mock('../../../services/firebase/scheduledJobs', () => ({ processPendingMembershipFees: async () => undefined }));
vi.mock('../../../services/firebase/featureVisibility', () => ({ isFeatureVisible: async () => true }));
vi.mock('../../../services/firebase/stores', () => ({ getAllStores: vi.fn(), createStore: vi.fn(), updateStore: vi.fn(), deleteStore: vi.fn() }));
vi.mock('../../../services/firebase/appConfig', () => ({ getAppConfig: async () => null }));
vi.mock('../../../components/admin/RoomManagement', () => ({ RoomManagement: () => null }));
vi.mock('../../../components/admin/LoungeOperations', () => ({ LoungeOperations: ({ store, onSaved }: any) => <button onClick={onSaved}>Operations for {store.name}</button> }));
import SystemConfig from './index';

afterEach(() => { cleanup(); mocks.refresh.mockClear(); });
describe('System Config lounge operations entry', () => {
  it('shows the shared operations control in each lounge card and refreshes after saving', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    render(<SystemConfig />);
    fireEvent.click(screen.getByRole('button', { name: /navigation.stores/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Operations for Test Lounge' }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  }, 15000);
});
