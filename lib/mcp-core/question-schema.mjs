// The canonical ask_user wire schema. Shared by the gateway, API and UI validator.
export const QUESTION_TYPES = ["text", "textarea", "number", "select", "radio", "multiselect", "checkbox", "toggle", "slider", "date", "time"];
export const QUESTION_ICONS = ["activity", "arrow-right", "check", "circle-help", "clock", "code", "cpu", "database", "file", "folder", "gauge", "globe", "info", "list-checks", "mail", "memory-stick", "monitor", "network", "palette", "search", "settings", "shield", "sliders-horizontal", "sparkles", "terminal", "user", "users", "wrench", "zap"];
const scalar = { anyOf: [{ type: "string", maxLength: 4000 }, { type: "number" }, { type: "boolean" }] };
const value = { anyOf: [...scalar.anyOf, { type: "array", maxItems: 100, items: scalar }, { type: "null" }] };
const icon = { type: "string", enum: QUESTION_ICONS };
const option = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 500 },
    {
      type: "object",
      properties: {
        label: { type: "string", minLength: 1, maxLength: 500 },
        value: scalar,
        description: { type: "string", maxLength: 1000 },
        icon,
      },
      required: ["label"],
      additionalProperties: false,
    },
  ],
};
export const ASK_USER_INPUT_SCHEMA = {
  "x-metis-waits-for-user": true,
  type: "object",
  properties: {
    title: { type: "string", maxLength: 200 },
    description: { type: "string", maxLength: 2000 },
    submitLabel: { type: "string", minLength: 1, maxLength: 100 },
    responseTemplate: { type: "string", maxLength: 4000, description: "Optional user-message template. Use {{field_key}} placeholders, replaced with human-readable labels. No code or expressions." },
    columns: { type: "integer", enum: [1, 2] },
    questions: {
      type: "array", minItems: 1, maxItems: 24,
      items: {
        type: "object",
        properties: {
          question: { type: "string", minLength: 1, maxLength: 2000 },
          key: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$", maxLength: 100, description: "Unique stable key for the typed values returned to the agent." },
          type: { type: "string", enum: QUESTION_TYPES },
          multiple: { type: "boolean", description: "Legacy compatibility: infer multiselect when true." },
          options: { type: "array", minItems: 1, maxItems: 100, items: option },
          required: { type: "boolean" },
          allowCustom: { type: "boolean", description: "Offer a custom answer alongside options. Enabled by default for legacy questions." },
          default: value,
          description: { type: "string", maxLength: 2000 },
          placeholder: { type: "string", maxLength: 200 },
          icon,
          unit: { type: "string", maxLength: 50 },
          group: { type: "string", maxLength: 200 },
          width: { type: "string", enum: ["half", "full"] },
          min: { type: "number" },
          max: { type: "number" },
          step: { type: "number", exclusiveMinimum: 0 },
          maxLength: { type: "integer", minimum: 1, maximum: 4000 },
          showWhen: {
            type: "object",
            properties: { key: { type: "string", minLength: 1, maxLength: 100 }, equals: scalar },
            required: ["key", "equals"], additionalProperties: false,
            description: "Show only when an earlier field equals this value (or a multiselect contains it). Hidden fields return null.",
          },
        },
        required: ["question"], additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};
export const ASK_USER_DESCRIPTION = "Ask the user through one modular form. This is a blocking tool: wait for the submitted user answer before any further work or tool call. A timeout, disconnect, default selection, or elapsed time is not an answer. Continue only after submission; cancellation stops the run. Use questions[].type for text, textarea, number, select, radio, multiselect, checkbox, toggle, slider, date or time; key for named typed results; options as strings or {label,value,description,icon}; required, default, min/max/step, groups and showWhen for validation and conditional fields. Set title, description, columns, submitLabel and optionally responseTemplate with {{key}} placeholders. Returns typed values by field key, readable summary, and legacy answers string[] in field order. Old question/options/multiple calls remain supported. Do not invent another form tool. Icons use supported Lucide names. For answer headings use [icon:monitor] or [icon:settings] (same icon vocabulary).";
