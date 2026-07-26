// Eval fixtures: briefs with a corpus that genuinely answers some questions and
// deliberately leaves others open, so the harness can tell a well-grounded run
// from a confident-sounding one.
export const FIXTURES = [
  {
    id: "eu-entry",
    prompt: "Should we expand our SaaS product into the EU market next year, and if so which country first?",
    sources: [
      {
        kind: "note",
        title: "EU market scan",
        content:
          "Our EU market scan found the European SaaS market grew 22% in 2024 to EUR 2.1B. Germany has the largest enterprise software spend in the EU at roughly EUR 640M annually, followed by France at EUR 410M and the Netherlands at EUR 180M. GDPR compliance for a new entrant costs an estimated EUR 90k upfront plus EUR 30k per year. Our pipeline contains 40 inbound enterprise leads originating from Germany and 12 from France.",
      },
      {
        kind: "note",
        title: "Partner vs build analysis",
        content:
          "A partner-led entry reaches first revenue in roughly 4 months versus 11 months for building a local entity. Partner margin is 25% of ARR. Building requires EUR 1.2M investment and a local managing director. Two competitors entered Germany partner-led and reached break-even in year two. Churn in partner-led motions runs 4 points higher than direct.",
      },
    ],
  },
  {
    id: "pricing-change",
    prompt: "Our conversion rate dropped 18% after the last pricing change. Should we roll it back?",
    sources: [
      {
        kind: "note",
        title: "Pricing change postmortem",
        content:
          "On 3 March we moved the Starter tier from USD 19 to USD 29 and removed the free trial. Trial-to-paid conversion fell from 11.2% to 9.2%, an 18% relative drop. Total revenue per visitor rose 6% because average revenue per account increased 34%. Support ticket volume about pricing tripled. Enterprise conversion was unchanged.",
      },
      {
        kind: "note",
        title: "Cohort retention data",
        content:
          "Accounts acquired after the price change show 30-day retention of 68% versus 54% for the prior cohort. Month-3 retention is 51% versus 39%. The post-change cohort has a higher proportion of accounts with more than 5 seats.",
      },
    ],
  },
  {
    id: "hiring-tradeoff",
    prompt: "We can afford two engineering hires this quarter. Should they be senior generalists or specialists in our data pipeline?",
    sources: [
      {
        kind: "note",
        title: "Engineering capacity review",
        content:
          "The data pipeline currently absorbs 40% of engineering time and is owned by one person who is a single point of failure. Feature velocity has fallen from 14 to 8 shipped items per quarter over three quarters. Two of the last four incidents originated in the pipeline and took a median 6 hours to resolve because only one engineer could debug them.",
      },
    ],
  },
];
