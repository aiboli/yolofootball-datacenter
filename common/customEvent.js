const ACTIVE_EVENT_STATUS = "active";
const LOCKED_EVENT_STATUS = "locked";
const COMPLETED_EVENT_STATUS = "completed";
const CANCELED_EVENT_STATUS = "canceled";
const SUPPORTED_EVENT_STATUSES = new Set([
  ACTIVE_EVENT_STATUS,
  LOCKED_EVENT_STATUS,
  COMPLETED_EVENT_STATUS,
  CANCELED_EVENT_STATUS,
]);
const SUPPORTED_FIXTURE_STATES = new Set([
  "notstarted",
  "ongoing",
  "finished",
  "canceled",
]);
const SUPPORTED_MARKET = "match_winner";
const EXPECTED_OPTION_SHAPE = [
  { result: 0, label: "Home" },
  { result: 1, label: "Draw" },
  { result: 2, label: "Away" },
];

const toCurrency = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Number(numericValue.toFixed(2));
};

const buildEmptyLiabilityByResult = () => ({
  0: 0,
  1: 0,
  2: 0,
});

const normalizeFixtureId = (fixtureId) => {
  if (typeof fixtureId === "string" && fixtureId.includes("@")) {
    return Number.parseInt(fixtureId.split("@")[1], 10);
  }

  return Number.parseInt(fixtureId, 10);
};

const normalizeFixtureState = (value, fallbackValue = "notstarted") => {
  return SUPPORTED_FIXTURE_STATES.has(value) ? value : fallbackValue;
};

const normalizeStatus = (value, fallbackValue = ACTIVE_EVENT_STATUS) => {
  return SUPPORTED_EVENT_STATUSES.has(value) ? value : fallbackValue;
};

const normalizeOddData = (oddData) => {
  if (
    !oddData ||
    oddData.market !== SUPPORTED_MARKET ||
    !Array.isArray(oddData.options) ||
    oddData.options.length !== EXPECTED_OPTION_SHAPE.length
  ) {
    return null;
  }

  const oddsByResult = {};
  oddData.options.forEach((option) => {
    const result = Number.parseInt(option?.result, 10);
    const odd = Number.parseFloat(option?.odd);

    if (Number.isInteger(result) && Number.isFinite(odd) && odd > 1) {
      oddsByResult[result] = odd;
    }
  });

  const normalizedOptions = EXPECTED_OPTION_SHAPE.map((expectedOption) => {
    if (!Object.prototype.hasOwnProperty.call(oddsByResult, expectedOption.result)) {
      return null;
    }

    return {
      result: expectedOption.result,
      label: expectedOption.label,
      odd: oddsByResult[expectedOption.result],
    };
  });

  if (normalizedOptions.some((option) => !option)) {
    return null;
  }

  return {
    market: SUPPORTED_MARKET,
    options: normalizedOptions,
  };
};

const normalizeLiabilityByResult = (liabilityByResult) => {
  const normalized = buildEmptyLiabilityByResult();

  Object.keys(normalized).forEach((resultKey) => {
    normalized[resultKey] = toCurrency(liabilityByResult?.[resultKey] || 0);
  });

  return normalized;
};

const normalizeSettlementSummary = (settlementSummary) => {
  if (!settlementSummary || typeof settlementSummary !== "object") {
    return null;
  }

  return {
    settled_at: settlementSummary.settled_at || null,
    outcome: settlementSummary.outcome || null,
    result: Number.isInteger(Number(settlementSummary.result))
      ? Number(settlementSummary.result)
      : null,
    owner_credit: toCurrency(settlementSummary.owner_credit || 0),
    total_staked: toCurrency(settlementSummary.total_staked || 0),
    winning_payout: toCurrency(settlementSummary.winning_payout || 0),
    winning_profit: toCurrency(settlementSummary.winning_profit || 0),
    winning_order_count: Number(settlementSummary.winning_order_count || 0),
    losing_order_count: Number(settlementSummary.losing_order_count || 0),
    void_order_count: Number(settlementSummary.void_order_count || 0),
  };
};

const getOptionForResult = (oddData, result) => {
  if (!Array.isArray(oddData?.options)) {
    return null;
  }

  return (
    oddData.options.find((option) => Number.parseInt(option?.result, 10) === Number(result)) || null
  );
};

const calculateExposureForStake = (odd, stake) => {
  const normalizedOdd = Number(odd);
  const normalizedStake = Number(stake);
  if (!Number.isFinite(normalizedOdd) || normalizedOdd <= 1 || !Number.isFinite(normalizedStake)) {
    return 0;
  }

  return toCurrency(normalizedStake * (normalizedOdd - 1));
};

const calculateRemainingLiability = (poolFund, liabilityByResult) => {
  const normalizedPoolFund = toCurrency(poolFund);
  const maxLiability = Math.max(
    ...Object.values(normalizeLiabilityByResult(liabilityByResult)).map((value) => toCurrency(value))
  );

  return toCurrency(Math.max(0, normalizedPoolFund - maxLiability));
};

const calculateMaxStakeByResult = (oddData, liabilityByResult, poolFund) => {
  const normalizedLiability = normalizeLiabilityByResult(liabilityByResult);
  const normalizedPoolFund = toCurrency(poolFund);
  const maxStakeByResult = buildEmptyLiabilityByResult();

  EXPECTED_OPTION_SHAPE.forEach((expectedOption) => {
    const option = getOptionForResult(oddData, expectedOption.result);
    const odd = Number(option?.odd);
    const availableLiability = toCurrency(
      Math.max(0, normalizedPoolFund - toCurrency(normalizedLiability[expectedOption.result]))
    );

    if (!Number.isFinite(odd) || odd <= 1) {
      maxStakeByResult[expectedOption.result] = 0;
      return;
    }

    maxStakeByResult[expectedOption.result] = toCurrency(availableLiability / (odd - 1));
  });

  return maxStakeByResult;
};

const hydrateCustomEvent = (event) => {
  const normalizedEvent = {
    ...event,
    fixture_id: normalizeFixtureId(event?.fixture_id),
    fixture_state: normalizeFixtureState(event?.fixture_state),
    status: normalizeStatus(event?.status),
    market: event?.market || event?.odd_data?.market || SUPPORTED_MARKET,
    odd_data: normalizeOddData(event?.odd_data) || event?.odd_data || null,
    pool_fund: toCurrency(event?.pool_fund || 0),
    matched_pool_fund: toCurrency(event?.matched_pool_fund || 0),
    invested_pool_fund: toCurrency(event?.invested_pool_fund || 0),
    actual_return: toCurrency(event?.actual_return || 0),
    associated_order_ids: Array.isArray(event?.associated_order_ids) ? event.associated_order_ids : [],
    liability_by_result: normalizeLiabilityByResult(event?.liability_by_result),
    settlement_summary: normalizeSettlementSummary(event?.settlement_summary),
  };

  normalizedEvent.bet_count = Array.isArray(normalizedEvent.associated_order_ids)
    ? normalizedEvent.associated_order_ids.length
    : 0;
  normalizedEvent.remaining_liability = calculateRemainingLiability(
    normalizedEvent.pool_fund,
    normalizedEvent.liability_by_result
  );
  normalizedEvent.max_stake_by_result = calculateMaxStakeByResult(
    normalizedEvent.odd_data,
    normalizedEvent.liability_by_result,
    normalizedEvent.pool_fund
  );
  normalizedEvent.can_accept_bets =
    normalizedEvent.status === ACTIVE_EVENT_STATUS &&
    normalizedEvent.pool_fund > 0 &&
    Object.values(normalizedEvent.max_stake_by_result).some((value) => Number(value) > 0);

  return normalizedEvent;
};

const buildEventHistoryEntry = (info, data = undefined) => ({
  time: new Date().toISOString(),
  info,
  ...(data !== undefined ? { data } : {}),
});

module.exports = {
  ACTIVE_EVENT_STATUS,
  LOCKED_EVENT_STATUS,
  COMPLETED_EVENT_STATUS,
  CANCELED_EVENT_STATUS,
  EXPECTED_OPTION_SHAPE,
  SUPPORTED_EVENT_STATUSES,
  SUPPORTED_FIXTURE_STATES,
  SUPPORTED_MARKET,
  buildEmptyLiabilityByResult,
  normalizeFixtureId,
  normalizeFixtureState,
  normalizeStatus,
  normalizeOddData,
  normalizeLiabilityByResult,
  normalizeSettlementSummary,
  getOptionForResult,
  calculateExposureForStake,
  calculateRemainingLiability,
  calculateMaxStakeByResult,
  hydrateCustomEvent,
  buildEventHistoryEntry,
  toCurrency,
};
