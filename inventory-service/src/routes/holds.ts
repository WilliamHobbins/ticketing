import { Router } from "express";
import { createHold, releaseHold } from "../holds";

export const holdsRouter = Router();

holdsRouter.post("/", async (req, res) => {
  const { eventId, seatId } = req.body ?? {};
  if (typeof eventId !== "string" || typeof seatId !== "string") {
    return res.status(400).json({
      error: { code: "INVALID_REQUEST", message: "eventId y seatId son obligatorios" },
    });
  }
  try {
    const hold = await createHold(eventId, seatId);
    if (!hold) {
      return res.status(409).json({
        error: { code: "SEAT_NOT_AVAILABLE", message: "El asiento ya está reservado" },
      });
    }
    return res.status(201).json(hold);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error interno" } });
  }
});

holdsRouter.delete("/:holdId", async (req, res) => {
  try {
    const released = await releaseHold(req.params.holdId);
    if (!released) {
      return res.status(404).json({
        error: { code: "HOLD_NOT_FOUND", message: "El hold no existe o ya venció" },
      });
    }
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error interno" } });
  }
});