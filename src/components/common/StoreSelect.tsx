import React, { useEffect } from 'react';
import { Select } from 'antd';
import { getAllStores } from '../../services/firebase/stores';
import { useFirestoreQuery } from '../../hooks/useFirestoreQuery';

interface StoreSelectProps {
  value?: string;
  onChange?: (storeId: string, storeName: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  placeholder?: string;
  className?: string;
  popupClassName?: string;
  /** Allow the field to be cleared (useful in forms). Default: false */
  allowClear?: boolean;
  /** Auto-select the first store when value is empty. Default: true */
  autoSelect?: boolean;
  /** Disable the dropdown when only one option exists. Default: true */
  disableWhenSingle?: boolean;
}

const StoreSelect: React.FC<StoreSelectProps> = ({
  value,
  onChange,
  disabled,
  style,
  placeholder,
  className = 'gold-select',
  popupClassName = 'gold-select-dropdown',
  allowClear = false,
  autoSelect = true,
  disableWhenSingle = true,
}) => {
  const { data: allStores, loading: storesLoading } = useFirestoreQuery(getAllStores);
  const stores = allStores.filter(s => s.status === 'active');

  // Auto-select first store when no value is set
  useEffect(() => {
    if (autoSelect && stores.length > 0 && !value) {
      const first = stores[0];
      onChange?.(first.id, first.name);
    }
  }, [stores.length, value, autoSelect]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (storeId: string) => {
    const store = stores.find(s => s.id === storeId);
    onChange?.(storeId, store?.name ?? '');
  };

  const isSingleOption = disableWhenSingle && stores.length <= 1;

  return (
    <Select
      value={value || undefined}
      onChange={handleChange}
      style={{ width: '100%', height: 44, ...style }}
      className={className}
      popupClassName={popupClassName}
      placeholder={placeholder}
      options={stores.map(s => ({ value: s.id, label: s.name }))}
      loading={storesLoading}
      disabled={disabled || storesLoading || isSingleOption}
      open={isSingleOption ? false : undefined}
      allowClear={allowClear}
    />
  );
};

export default StoreSelect;
