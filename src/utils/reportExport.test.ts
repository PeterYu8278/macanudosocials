import { describe, expect, it } from 'vitest';
import { utils } from 'xlsx';
import { visibleReportRows } from './reportExport';

describe('visible Excel report columns', () => {
  it('removes the three internal IDs from worksheet headers without changing source rows', () => {
    const source = { 'User ID': 'user', 'Member ID': 'member', Name: 'Name', 'Reload ID': 'reload',
      'Points Record ID': 'points', 'Membership Order ID': 'order', 'Points Equivalent': 100 };
    const rows = visibleReportRows([source]);
    expect(rows).toEqual([{ 'Member ID': 'member', Name: 'Name', 'Reload ID': 'reload', 'Points Equivalent': 100 }]);
    const worksheet = utils.json_to_sheet(rows);
    expect(utils.sheet_to_json(worksheet, { header: 1 })[0]).toEqual(['Member ID', 'Name', 'Reload ID', 'Points Equivalent']);
    expect(source['User ID']).toBe('user');
    expect(source['Points Record ID']).toBe('points');
    expect(source['Membership Order ID']).toBe('order');
  });
  it('handles missing fields and empty worksheets', () => {
    expect(visibleReportRows([])).toEqual([]);
    expect(visibleReportRows([{ Name: 'Member', Status: 'completed' }])).toEqual([{ Name: 'Member', Status: 'completed' }]);
  });
});
