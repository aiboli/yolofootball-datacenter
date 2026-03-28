const DEFAULT_ONBOARDING_STATE = {
  signup_completed: true,
  preferences_completed: false,
  starter_slip_loaded: false,
  first_prediction_completed: false,
  first_order_completed: false,
  first_custom_odds_completed: false,
};

const sanitizeStringArray = (value) =>
  Array.isArray(value)
    ? value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, 12)
    : [];

const createDefaultOnboardingState = () => ({
  ...DEFAULT_ONBOARDING_STATE,
});

const mergeOnboardingState = (currentState, nextState) => {
  const mergedState = {
    ...createDefaultOnboardingState(),
    ...(currentState && typeof currentState === "object" ? currentState : {}),
  };

  if (!nextState || typeof nextState !== "object") {
    return mergedState;
  }

  Object.keys(DEFAULT_ONBOARDING_STATE).forEach((key) => {
    if (typeof nextState[key] === "boolean") {
      mergedState[key] = nextState[key];
    }
  });

  return mergedState;
};

const normalizePredictionRecord = (prediction) => {
  if (!prediction || typeof prediction !== "object") {
    return null;
  }

  const fixtureId = Number.parseInt(prediction.fixture_id, 10);
  const predictedResult = Number.parseInt(prediction.predicted_result, 10);
  if (!Number.isInteger(fixtureId) || !Number.isInteger(predictedResult)) {
    return null;
  }

  return {
    id:
      typeof prediction.id === "string" && prediction.id.trim().length > 0
        ? prediction.id.trim()
        : `${fixtureId}-${Date.now()}`,
    fixture_id: fixtureId,
    market: prediction.market || "match_winner",
    predicted_result: predictedResult,
    predicted_label: prediction.predicted_label || null,
    fixture_state: prediction.fixture_state || "notstarted",
    created_at: prediction.created_at || new Date().toISOString(),
  };
};

const upsertPredictionHistory = (predictionHistory, prediction) => {
  const normalizedPrediction = normalizePredictionRecord(prediction);
  if (!normalizedPrediction) {
    return Array.isArray(predictionHistory) ? predictionHistory : [];
  }

  const currentHistory = Array.isArray(predictionHistory) ? [...predictionHistory] : [];
  const existingIndex = currentHistory.findIndex(
    (item) => Number.parseInt(item?.fixture_id, 10) === normalizedPrediction.fixture_id
  );

  if (existingIndex >= 0) {
    currentHistory[existingIndex] = {
      ...currentHistory[existingIndex],
      ...normalizedPrediction,
    };
  } else {
    currentHistory.push(normalizedPrediction);
  }

  return currentHistory
    .sort(
      (left, right) =>
        new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime()
    )
    .slice(0, 50);
};

module.exports = {
  DEFAULT_ONBOARDING_STATE,
  sanitizeStringArray,
  createDefaultOnboardingState,
  mergeOnboardingState,
  normalizePredictionRecord,
  upsertPredictionHistory,
};
