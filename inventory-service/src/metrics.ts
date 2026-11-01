import * as client from "prom-client";

// Registro propio: todas las métricas del servicio viven acá.
export const register = new client.Registry();

// Etiqueta que se agrega a todas las métricas, para distinguir este servicio en Grafana.
register.setDefaultLabels({ service: "inventory-service" });

// Métricas estándar del proceso (memoria, CPU, event loop...). Vienen gratis con la librería.
client.collectDefaultMetrics({ register });