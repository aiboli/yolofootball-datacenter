const { randomUUID } = require("crypto");
const axios = require("axios").default;
const { ensureContainer } = require("./database");

const API_USAGE_CONTAINER_ID = "api_usage";
const DEFAULT_PROVIDER = "api-football";
const DEFAULT_TIMEZONE = "America/Los_Angeles";
const MAX_ERROR_MESSAGE_LENGTH = 500;

let apiUsageContainerPromise = null;

const getApiUsageContainer = async () => {
  if (!apiUsageContainerPromise) {
    apiUsageContainerPromise = ensureContainer(API_USAGE_CONTAINER_ID, "/date");
  }

  return apiUsageContainerPromise;
};

const getPacificDateString = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
};

const getEndpoint = (url) => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname.replace(/^\/v\d+/, "") || parsedUrl.pathname;
  } catch (error) {
    return String(url || "unknown");
  }
};

const normalizeParamValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    return value;
  }
  return String(value);
};

const normalizeParams = (params = {}) =>
  Object.keys(params)
    .sort()
    .reduce((normalizedParams, key) => {
      normalizedParams[key] = normalizeParamValue(params[key]);
      return normalizedParams;
    }, {});

const getHeader = (headers = {}, headerName) => {
  const normalizedHeaderName = headerName.toLowerCase();
  const matchingKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === normalizedHeaderName
  );
  return matchingKey ? headers[matchingKey] : null;
};

const buildRateLimitSnapshot = (headers = {}) => {
  const limit = getHeader(headers, "x-ratelimit-requests-limit");
  const remaining = getHeader(headers, "x-ratelimit-requests-remaining");
  const reset = getHeader(headers, "x-ratelimit-requests-reset");

  if (limit === null && remaining === null && reset === null) {
    return null;
  }

  return {
    limit,
    remaining,
    reset,
  };
};

const buildRequestKey = ({ job, endpoint, params }) => {
  const paramsKey = Object.keys(params)
    .map((key) => `${key}=${params[key] === null ? "" : params[key]}`)
    .join("|");

  return [job, endpoint, paramsKey].filter(Boolean).join("|");
};

const toSafeErrorMessage = (error) => {
  const message =
    error?.response?.data?.message ||
    error?.response?.statusText ||
    error?.message ||
    "unknown error";

  return String(message).slice(0, MAX_ERROR_MESSAGE_LENGTH);
};

const buildUsageDocument = ({
  options,
  metadata = {},
  response = null,
  error = null,
  startedAt,
  endedAt,
}) => {
  const params = normalizeParams(options?.params || {});
  const provider = metadata.provider || DEFAULT_PROVIDER;
  const job = metadata.job || "unknown";
  const endpoint = metadata.endpoint || getEndpoint(options?.url);
  const status = error ? "error" : "success";
  const statusCode = response?.status || error?.response?.status || null;
  const calledAt = endedAt.toISOString();
  const date = getPacificDateString(endedAt);
  const responseItems = Array.isArray(response?.data?.response)
    ? response.data.response.length
    : null;
  const paging = response?.data?.paging || error?.response?.data?.paging || null;

  return {
    id: `${provider}-${date}-${endedAt.getTime()}-${randomUUID()}`,
    date,
    provider,
    source: metadata.source || "cron",
    job,
    endpoint,
    method: options?.method || "GET",
    request_key: buildRequestKey({ job, endpoint, params }),
    params,
    status,
    status_code: statusCode,
    duration_ms: Math.max(0, endedAt.getTime() - startedAt.getTime()),
    called_at: calledAt,
    response_items: responseItems,
    paging_total: paging?.total ?? null,
    paging_current: paging?.current ?? null,
    rate_limit: buildRateLimitSnapshot(response?.headers || error?.response?.headers || {}),
    error_message: error ? toSafeErrorMessage(error) : null,
  };
};

const recordApiUsage = async (usageDocument) => {
  try {
    const container = await getApiUsageContainer();
    await container.items.create(usageDocument);
  } catch (error) {
    console.log("failed to record api usage");
    console.log(error);
  }
};

const requestWithApiUsage = async (options, metadata = {}) => {
  const startedAt = new Date();

  try {
    const response = await axios.request(options);
    await recordApiUsage(
      buildUsageDocument({
        options,
        metadata,
        response,
        startedAt,
        endedAt: new Date(),
      })
    );
    return response;
  } catch (error) {
    await recordApiUsage(
      buildUsageDocument({
        options,
        metadata,
        error,
        startedAt,
        endedAt: new Date(),
      })
    );
    throw error;
  }
};

const incrementStatusTotals = (target, status) => {
  target.total_count += 1;
  if (status === "success") {
    target.success_count += 1;
  } else {
    target.error_count += 1;
  }
};

const summarizeUsageDocuments = (documents = [], { date, provider } = {}) => {
  const summary = {
    date,
    provider,
    total_count: 0,
    success_count: 0,
    error_count: 0,
    by_job: {},
    by_endpoint: {},
    requests: [],
  };
  const requestGroups = {};

  documents.forEach((document) => {
    const status = document.status === "success" ? "success" : "error";
    const job = document.job || "unknown";
    const endpoint = document.endpoint || "unknown";
    const requestKey = document.request_key || `${job}|${endpoint}`;

    incrementStatusTotals(summary, status);

    if (!summary.by_job[job]) {
      summary.by_job[job] = { total_count: 0, success_count: 0, error_count: 0 };
    }
    incrementStatusTotals(summary.by_job[job], status);

    if (!summary.by_endpoint[endpoint]) {
      summary.by_endpoint[endpoint] = {
        total_count: 0,
        success_count: 0,
        error_count: 0,
      };
    }
    incrementStatusTotals(summary.by_endpoint[endpoint], status);

    if (!requestGroups[requestKey]) {
      requestGroups[requestKey] = {
        request_key: requestKey,
        job,
        endpoint,
        params: document.params || {},
        total_count: 0,
        success_count: 0,
        error_count: 0,
        response_items: 0,
        last_called_at: null,
        last_status_code: null,
        last_error_message: null,
        latest_rate_limit: null,
      };
    }

    const requestGroup = requestGroups[requestKey];
    incrementStatusTotals(requestGroup, status);
    if (Number.isFinite(Number(document.response_items))) {
      requestGroup.response_items += Number(document.response_items);
    }
    if (
      !requestGroup.last_called_at ||
      new Date(document.called_at).getTime() > new Date(requestGroup.last_called_at).getTime()
    ) {
      requestGroup.last_called_at = document.called_at;
      requestGroup.last_status_code = document.status_code || null;
      requestGroup.last_error_message = document.error_message || null;
      requestGroup.latest_rate_limit = document.rate_limit || null;
    }
  });

  summary.requests = Object.values(requestGroups).sort((left, right) => {
    if (left.job !== right.job) {
      return left.job.localeCompare(right.job);
    }
    if (left.endpoint !== right.endpoint) {
      return left.endpoint.localeCompare(right.endpoint);
    }
    return left.request_key.localeCompare(right.request_key);
  });

  return summary;
};

const summarizeApiUsage = async ({
  date = getPacificDateString(),
  provider = DEFAULT_PROVIDER,
} = {}) => {
  const container = await getApiUsageContainer();
  const result = await container.items
    .query({
      query: "SELECT * FROM c WHERE c.date = @date AND c.provider = @provider",
      parameters: [
        { name: "@date", value: date },
        { name: "@provider", value: provider },
      ],
    })
    .fetchAll();

  return summarizeUsageDocuments(result.resources || [], { date, provider });
};

module.exports = {
  DEFAULT_PROVIDER,
  getPacificDateString,
  requestWithApiUsage,
  summarizeApiUsage,
  summarizeUsageDocuments,
};
