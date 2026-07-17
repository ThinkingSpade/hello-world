# What 7,043 real customers taught me about churn

The write-up behind [Churn Radar](https://hnguyen.dev/churn/). Every number
here is reproducible: `python -m churn train` retrains from the raw CSV in
`data/` and regenerates every figure and export.

## The data, as it actually arrived

The public IBM Telco dataset: 7,043 customer records, 1,869 churned (26.5%).
Two quirks worth knowing:

- **11 blank `TotalCharges`** — all brand-new customers (tenure 0). Coerced
  to 0 rather than dropped; brand-new customers are exactly who a churn
  model needs to see.
- **`TotalCharges` ≈ tenure × MonthlyCharges** (r > 0.99). I dropped it.
  Keeping it double-counts the same signal through a noisier proxy and makes
  coefficients unreadable — the classic quiet leakage-adjacent mistake.

`SeniorCitizen` arrives as 0/1 while every other flag is Yes/No; normalized
to Yes/No so the encoding is uniform.

## The bake-off: the readable model won

| model | ROC AUC | avg precision | Brier |
|---|---|---|---|
| logistic regression | **0.845** | **0.635** | **0.137** |
| gradient boosting (HistGB) | 0.830 | 0.627 | 0.143 |

5-fold CV on the training side: 0.843 ± 0.014 — the split isn't lucky.
With ~7k rows of mostly categorical features there are no deep interactions
for boosting to mine; it spends its capacity memorizing noise, and pays for
it on every metric including calibration (Brier).

The shipped model is therefore plain logistic regression, exported as named
coefficients (`model.json`) and scored in ~30 lines of browser JS. A test
asserts the exported spec reproduces sklearn's probabilities to within 5e-5.

## Calibration: the probabilities mean what they say

The reliability diagram (`assets/calibration.png`) tracks the diagonal
closely across all ten bins — when the model says "40%", about 40% of those
customers actually churned. That's what makes the decision layer below
legitimate: expected-value math on badly calibrated probabilities is
fiction with extra steps.

## The segment audit — where the model is weaker, said out loud

AUC on the held-out set, by segment:

| segment | n | AUC | observed churn | predicted churn |
|---|---|---|---|---|
| Contract: Month-to-month | 968 | 0.742 | 42.8% | 42.7% |
| Contract: One year | 366 | 0.730 | 11.7% | 11.3% |
| Contract: Two year | 427 | 0.755 | 2.3% | 3.3% |
| Internet: DSL | 605 | 0.820 | 19.2% | 18.2% |
| Internet: Fiber optic | 773 | 0.782 | 41.5% | 43.0% |
| Internet: none | 383 | 0.892 | 7.8% | 7.0% |
| Senior: No | 1,475 | 0.845 | 23.4% | 23.5% |
| Senior: Yes | 286 | 0.797 | 42.7% | 42.6% |

Two honest readings:

1. **The global 0.845 is partly the contract variable doing the work.**
   *Within* a contract tier, ranking power drops to ~0.73–0.76. The model is
   excellent at separating tiers and merely decent at ordering customers
   inside one. Any pitch of this model should say that.
2. **Seniors score slightly worse (0.797)** but calibration holds (42.6%
   predicted vs 42.7% observed), so decisions costed on probabilities stay
   fair even where ranking is weaker.

## When, not just if: the survival view

Churn isn't a coin flip, it's a clock. Treating tenure as time-to-event
(churners = events, active customers = censored at their current tenure),
Kaplan-Meier retention curves by contract show month-to-month falling off a
cliff in the first year while two-year contracts barely move. The dashboard
computes these curves live from the raw rows.

*Caveat stated plainly:* this dataset is a snapshot, not a longitudinal
log — tenure-at-snapshot censoring is the standard framing for it, but real
survival work wants event timestamps.

## From probabilities to money: the decision layer

A churn score is only useful at the moment someone decides whom to call.
The dashboard's intervention simulator does that math in the open, on the
real rows, with every assumption adjustable:

- target customers above a risk threshold τ
- each offer costs `C` (default $40)
- an offer saves an actual churner with probability `s` (default 30%)
- a saved customer is worth `H` months of their real monthly charges
  (default 12)

Expected net = `s × Σ pᵢ·H·chargesᵢ` (over targeted) − `C × n_targeted`,
alongside the *realized* precision/recall at τ against the actual labels.
The profit curve is concave with an interior optimum — set the threshold
too low and offer costs eat the gains, too high and the saves vanish.

## What I'd do next with production data

Event-timestamped churn (true survival modeling), price-change history
(the contract coefficient is confounded — do contracts cause loyalty, or do
loyal customers accept contracts?), and an uplift model: predicting *who
churns* is step one; predicting *whose churn an offer actually prevents* is
the model the retention budget deserves.
