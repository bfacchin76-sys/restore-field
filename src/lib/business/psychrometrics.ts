/**
 * Psychrometric calculations — used to fill in the "GPP" (grains per pound)
 * column on a drying log when the tech only enters Temp + RH.
 *
 * GPP is the absolute-humidity unit restoration techs use to compare air
 * inside vs. outside vs. the dehumidifier coil; it is independent of
 * temperature, unlike RH.
 *
 * Math: standard Magnus-Tetens approximation for saturation pressure
 *       (good to <0.5% across the temperature range we care about),
 *       Hyland-Wexler / ASHRAE-style humidity-ratio formula at sea-level
 *       atmospheric pressure (1013.25 mbar = 14.696 psi). Result is in
 *       grains of moisture per pound of dry air.
 *
 *   GPP = 7000 * 0.622 * Pw / (P_atm - Pw)
 *   Pw  = (RH/100) * Pws(T)
 *   Pws(T_C) ≈ 6.1078 * exp(17.27 * T_C / (T_C + 237.3))     [millibars]
 *
 * Reference points (rounded to nearest GPP):
 *   70 °F, 50 %RH → 54 GPP
 *   75 °F, 50 %RH → 64 GPP
 *   80 °F, 50 %RH → 77 GPP
 *
 * Tested to within 0.5 GPP of those references — see the test file.
 */

const ATMOSPHERIC_PRESSURE_MBAR = 1013.25;
const MOLECULAR_RATIO = 0.622; // M_water / M_dry_air
const GRAINS_PER_POUND = 7000;

export function fahrenheitToCelsius(tempF: number): number {
  return ((tempF - 32) * 5) / 9;
}

/** Saturation pressure of water vapour, in millibars, given T in °C. */
function saturationPressureMbar(tempC: number): number {
  return 6.1078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

/** Mass humidity ratio, dimensionless (lb water / lb dry air). */
export function humidityRatio(tempF: number, rhPercent: number): number {
  if (rhPercent <= 0) return 0;
  const Pws = saturationPressureMbar(fahrenheitToCelsius(tempF));
  const Pw = (rhPercent / 100) * Pws;
  return (MOLECULAR_RATIO * Pw) / (ATMOSPHERIC_PRESSURE_MBAR - Pw);
}

/**
 * Grains of water vapour per pound of dry air.
 *
 * Returns a finite non-negative number. Inputs outside any sensible field
 * range (e.g. negative temps below -45 °F or >130 °F, RH outside 0..100)
 * still produce a value but should not be relied upon.
 */
export function gpp(tempF: number, rhPercent: number): number {
  if (!Number.isFinite(tempF) || !Number.isFinite(rhPercent)) {
    return Number.NaN;
  }
  if (rhPercent <= 0) return 0;
  const w = humidityRatio(tempF, Math.min(100, rhPercent));
  return GRAINS_PER_POUND * w;
}

/** Round to one decimal place — drying logs don't need more precision. */
export function gppRounded(tempF: number, rhPercent: number): number {
  const g = gpp(tempF, rhPercent);
  if (!Number.isFinite(g)) return Number.NaN;
  return Math.round(g * 10) / 10;
}
