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
