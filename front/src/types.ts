export interface EventSummary {
  id: string;
  title: string;
  startsAt: string;
  venueName: string;
  venueCity: string;
  category: string;
  minPrice: number | null;
  basePrice: number;
}

export interface Seat {
  id: string;
  sector: string;
  row: string | number;
  number: string | number;
  price: number;
  status: string;
}

export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'PAYMENT_FAILED' | 'EXPIRED' | 'REFUNDED';

export interface Order {
  orderId: string;
  eventId: string;
  holdId: string;
  status: OrderStatus;
  total: number;
  seatIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  ticketId: string;
  seatId: string;
  code: string;
  status: 'VALID' | 'VOIDED';
}