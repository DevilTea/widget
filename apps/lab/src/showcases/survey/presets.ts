/**
 * Showcase A ("Interactive Survey") preset source texts (checkpoint §6).
 *
 * Each preset is plain JSON source text that goes through the exact same Apply pipeline as manual
 * editing (`LabSession.applyPreset`) — no bypass of `JSON.parse` or `WidgetSystem.createBlueprint`.
 * The canonical valid preset preserves the checkpoint's exact topology, widget ids, and config links
 * verbatim; the second preset is the same topology with one representative default changed
 * (`children: 2` instead of `0`, `family-priority` still unanswered) to demonstrate the
 * `TripReadiness` contextual failure from checkpoint C1/§4.3 without inventing any new structure.
 */

export interface SurveyPreset {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly sourceText: string
}

function surveySource(childrenDefault: number): string {
	return `{
  "id": "trip-survey",
  "type": "TripSurvey",
  "config": {
    "resetQuestionIds": ["departure", "return", "adults", "children", "budget", "destination", "travel-style", "family-priority"],
    "readinessId": "trip-readiness",
    "recommendationId": "trip-recommendation"
  },
  "slots": {
    "form": [
      {
        "id": "trip-basics",
        "type": "SurveySection",
        "config": { "title": "Trip basics" },
        "slots": {
          "body": [
            { "id": "departure", "type": "SurveyDateQuestion", "config": { "label": "Departure date", "help": "When does the trip start?", "default": "2027-04-10" } },
            { "id": "return", "type": "SurveyDateQuestion", "config": { "label": "Return date", "help": "When does the trip end?", "default": "2027-04-14" } },
            { "id": "adults", "type": "SurveyNumberQuestion", "config": { "label": "Adults", "min": 1, "max": 8, "integer": true, "default": 2 } },
            { "id": "children", "type": "SurveyNumberQuestion", "config": { "label": "Children", "min": 0, "max": 8, "integer": true, "default": ${childrenDefault} } }
          ]
        }
      },
      {
        "id": "trip-preferences",
        "type": "SurveySection",
        "config": { "title": "Preferences" },
        "slots": {
          "body": [
            {
              "id": "destination",
              "type": "SurveyChoiceQuestion",
              "config": {
                "label": "Destination",
                "options": [
                  { "value": "tokyo", "label": "Tokyo" },
                  { "value": "seoul", "label": "Seoul" },
                  { "value": "bangkok", "label": "Bangkok" }
                ],
                "default": "tokyo"
              }
            },
            {
              "id": "travel-style",
              "type": "SurveyChoiceQuestion",
              "config": {
                "label": "Travel style",
                "options": [
                  { "value": "budget", "label": "Budget" },
                  { "value": "balanced", "label": "Balanced" },
                  { "value": "comfort", "label": "Comfort" }
                ],
                "default": "balanced"
              }
            },
            { "id": "budget", "type": "SurveyNumberQuestion", "config": { "label": "Total trip budget (USD, illustrative)", "help": "A synthetic demo figure — not real travel pricing.", "min": 200, "max": 20000, "integer": true, "default": 1800 } }
          ]
        }
      },
      {
        "id": "family-section",
        "type": "ConditionalSection",
        "config": {
          "title": "Family preferences",
          "condition": { "widgetId": "children", "stateKey": "answer", "operator": "greater-than", "value": 0 }
        },
        "slots": {
          "body": [
            {
              "id": "family-priority",
              "type": "SurveyChoiceQuestion",
              "config": {
                "label": "What matters most while traveling with children?",
                "options": [
                  { "value": "easy-transit", "label": "Easy transit" },
                  { "value": "kid-friendly", "label": "Kid-friendly activities" },
                  { "value": "relaxed-pace", "label": "Relaxed pace" }
                ],
                "default": null
              }
            }
          ]
        }
      },
      {
        "id": "live-estimate",
        "type": "SurveySection",
        "config": { "title": "Live estimate", "description": "Updates as you answer — illustrative/demo values, not real travel pricing." },
        "slots": {
          "body": [
            {
              "id": "trip-metrics",
              "type": "TripMetrics",
              "config": {
                "departureId": "departure",
                "returnId": "return",
                "adultsId": "adults",
                "childrenId": "children",
                "budgetId": "budget",
                "destinationId": "destination",
                "travelStyleId": "travel-style"
              }
            }
          ]
        }
      }
    ],
    "semantics": [
      {
        "id": "trip-readiness",
        "type": "TripReadiness",
        "config": {
          "departureId": "departure",
          "returnId": "return",
          "adultsId": "adults",
          "childrenId": "children",
          "budgetId": "budget",
          "destinationId": "destination",
          "travelStyleId": "travel-style",
          "familyPriorityId": "family-priority",
          "metricsId": "trip-metrics"
        }
      },
      {
        "id": "trip-recommendation",
        "type": "TripRecommendation",
        "config": {
          "readinessId": "trip-readiness",
          "metricsId": "trip-metrics",
          "budgetId": "budget",
          "destinationId": "destination",
          "travelStyleId": "travel-style",
          "childrenId": "children",
          "familyPriorityId": "family-priority"
        }
      }
    ]
  }
}
`
}

const validSurveySource = surveySource(0)
const notReadySurveySource = surveySource(2)

export const surveyPresets: readonly SurveyPreset[] = [
	{
		id: 'survey-default',
		label: 'Default — ready to submit',
		description: 'The canonical valid Interactive Survey source (checkpoint §6): every required answer has a default, so TripReadiness.ready succeeds and Submit / Generate result both work.',
		sourceText: validSurveySource,
	},
	{
		id: 'survey-not-ready',
		label: 'Not ready — family priority missing',
		description: 'Same topology, `children` defaults to 2 with `family-priority` left unanswered: TripReadiness.ready fails with a contextual issue (checkpoint C1), and Submit fails through Method dependency propagation.',
		sourceText: notReadySurveySource,
	},
]

export const defaultSurveyPreset: SurveyPreset = surveyPresets[0]!
