import type { OrderStatus } from './types';

export const STATUS_LABEL: Record<OrderStatus, string> = {
    PENDING_PAYMENT: 'Pendiente de pago',
    PAID: 'Pagado',
    PAYMENT_FAILED: 'Pago rechazado',
    EXPIRED: 'Reserva vencida',
    REFUNDED: 'Reembolsado',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
    return <span className={'badge badge--' + status.toLowerCase().replace('_', '-')}>{STATUS_LABEL[status] ?? status}</span>;
}