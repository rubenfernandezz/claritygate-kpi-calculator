/** Metric definitions derived from the calculator model; no external benchmark dataset. */
window.METRIC_GUIDE = [
  {
    "metric": "PUR — Pick-up rate",
    "formula": "Human answers ÷ dials × 100",
    "description": "Counts an answer by either a gatekeeper or a stakeholder. Voicemail is not a human answer."
  },
  {
    "metric": "GR — Gatekeeper rate",
    "formula": "Gatekeeper answers ÷ human answers × 100",
    "description": "Splits answered calls into gatekeeper and direct-contact paths. The direct-contact share is 100% minus GR."
  },
  {
    "metric": "GBR — Gatekeeper bypass rate",
    "formula": "Stakeholders reached via gatekeepers ÷ gatekeeper answers × 100",
    "description": "Applies only to the gatekeeper path. It does not describe all answered calls or all dials."
  },
  {
    "metric": "QR — Qualification rate",
    "formula": "Qualified stakeholders ÷ stakeholders reached × 100",
    "description": "Qualification follows the convergence of direct contact and successful gatekeeper bypass. Define qualification consistently for your own records."
  },
  {
    "metric": "ABR — Appointment booking rate",
    "formula": "Booked appointments ÷ qualified stakeholders × 100",
    "description": "This calculator uses qualified stakeholders as the denominator. Meetings per dial is a different rate."
  },
  {
    "metric": "SUR — Show-up rate",
    "formula": "Attended sales calls ÷ booked appointments × 100",
    "description": "Use the same cohort of appointments for numerator and denominator. A booking alone is not an attended call."
  },
  {
    "metric": "GFR — Pitch rate",
    "formula": "Pitches ÷ attended sales calls × 100",
    "description": "Represents the share of attended calls that progress to a pitch or proposal in this model."
  },
  {
    "metric": "SCR — Sale close rate",
    "formula": "New clients ÷ pitches × 100",
    "description": "This calculator measures closes against pitches. Clients per attended sales call has a different denominator."
  },
  {
    "metric": "Dial-to-client conversion",
    "formula": "PUR × [(1 − GR) + GR × GBR] × QR × ABR × SUR × GFR × SCR",
    "description": "Use fractions from 0 to 1 in this formula. All bundled rates and scenarios are illustrative inputs, not industry benchmarks or observed business results."
  }
];
