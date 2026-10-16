export interface ChatRoomRow {
  id: number;
  customer_id: number;
  admin_id: number | null;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
  customer_name: string;
  /** Unread from the VIEWER's point of view (see the repository). */
  unread_count: number;
}

export interface MessageRow {
  id: number;
  room_id: number;
  sender_id: number;
  message: string;
  read_at: Date | null;
  created_at: Date;
}
