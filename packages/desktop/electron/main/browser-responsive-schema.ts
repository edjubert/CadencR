import { z } from "zod";

import {
  BROWSER_RESPONSIVE_COLOR_SCHEMES,
  BROWSER_RESPONSIVE_PRESETS,
  MAX_BROWSER_RESPONSIVE_DIMENSION,
  MAX_BROWSER_RESPONSIVE_DPR,
  MAX_BROWSER_RESPONSIVE_SURFACE,
  MIN_BROWSER_RESPONSIVE_DIMENSION,
  type BrowserResponsiveRequest,
} from "./browser-types";

const dimension = z
  .number()
  .finite()
  .int()
  .min(MIN_BROWSER_RESPONSIVE_DIMENSION)
  .max(MAX_BROWSER_RESPONSIVE_DIMENSION);

const browserResponsiveSchema = z
  .object({
    enabled: z.boolean(),
    preset: z.enum(BROWSER_RESPONSIVE_PRESETS),
    width: dimension,
    height: dimension,
    deviceScaleFactor: z.number().finite().min(1).max(MAX_BROWSER_RESPONSIVE_DPR),
    mobile: z.boolean(),
    touch: z.boolean(),
    colorScheme: z.enum(BROWSER_RESPONSIVE_COLOR_SCHEMES),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.width * value.height > MAX_BROWSER_RESPONSIVE_SURFACE) {
      context.addIssue({
        code: "custom",
        message: `Responsive viewport area cannot exceed ${MAX_BROWSER_RESPONSIVE_SURFACE} pixels.`,
      });
    }
  });

export function parseBrowserResponsiveRequest(value: unknown): BrowserResponsiveRequest {
  return browserResponsiveSchema.parse(value);
}
