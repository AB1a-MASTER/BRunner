// core/dataTransforms.js
// Pure transformation runtime for sequential data nodes.

import { Actions } from "./constants.js";

export function isDataTransformAction(action) {
  return [
    Actions.DataJsonParse,
    Actions.DataJsonStringify,
    Actions.DataRegexMatch,
    Actions.DataRegexReplace,
    Actions.DataToNumber,
    Actions.DataFormatDate,
  ].includes(action);
}

export function executeDataTransform(action, config = {}) {
  switch (action) {
    case Actions.DataJsonParse:
      if (typeof config.input !== "string") {
        return structuredClone(config.input);
      }
      return JSON.parse(config.input);

    case Actions.DataJsonStringify:
      return JSON.stringify(
        config.input,
        null,
        config.pretty === true || config.pretty === "true" ? 2 : 0,
      );

    case Actions.DataRegexMatch: {
      const regex = createRegex(config.pattern, config.flags);
      return String(config.input ?? "").match(regex) || [];
    }

    case Actions.DataRegexReplace: {
      const regex = createRegex(config.pattern, config.flags || "g");
      return String(config.input ?? "").replace(
        regex,
        String(config.replacement ?? ""),
      );
    }

    case Actions.DataToNumber: {
      const value = Number(config.input);
      if (!Number.isFinite(value)) {
        throw new Error(`Cannot convert value to a finite number: ${config.input}`);
      }
      return value;
    }

    case Actions.DataFormatDate: {
      const date = new Date(config.input);
      if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid date value: ${config.input}`);
      }

      const format = config.format || "iso";
      if (format === "timestamp") return date.getTime();
      if (format === "locale") return date.toLocaleString();
      return date.toISOString();
    }

    default:
      throw new Error(`Unsupported data transform action: ${action}`);
  }
}

function createRegex(pattern, flags = "") {
  const text = String(pattern || "");
  if (!text) throw new Error("Regular expression pattern is empty.");

  try {
    return new RegExp(text, String(flags || ""));
  } catch (error) {
    throw new Error(`Invalid regular expression: ${error.message || error}`);
  }
}

