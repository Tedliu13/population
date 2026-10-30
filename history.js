// Center years before fitting to avoid a large calendar-year intercept.
export function fitPopulationTrend(years, values) {
  if (years.length !== values.length || years.length < 2 ||
      ![...years, ...values].every(Number.isFinite)) throw new Error("Invalid historical observations");
  const meanYear = years.reduce((a, b) => a + b, 0) / years.length;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const denominator = years.reduce((sum, year) => sum + (year - meanYear) ** 2, 0);
  if (!denominator) throw new Error("Distinct historical years required");
  const slope = years.reduce((sum, year, i) => sum + (year - meanYear) * (values[i] - mean), 0) / denominator;
  const fitted = years.map(year => mean + slope * (year - meanYear));
  const total = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const residual = values.reduce((sum, value, i) => sum + (value - fitted[i]) ** 2, 0);
  return { slope, fitted, rSquared: total === 0 ? null : 1 - residual / total };
}
