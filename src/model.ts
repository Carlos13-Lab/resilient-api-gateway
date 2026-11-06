import { z } from "zod";

/** The one contract every adapter must produce. */
export const Policy = z.object({
  id: z.string(),
  provider: z.enum(["north", "south", "east"]),
  holderId: z.string(),
  status: z.enum(["active", "cancelled", "expired"]),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  premium: z.object({ amount: z.number(), currency: z.string().length(3) }),
});
export type Policy = z.infer<typeof Policy>;
