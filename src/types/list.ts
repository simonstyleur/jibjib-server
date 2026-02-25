export interface List {
  id: string;
  name: string;
  is_active: boolean;
  item_count?: number;
  checked_count?: number;
  has_active_trip?: boolean;
  created_at: string;
  updated_at: string;
}
