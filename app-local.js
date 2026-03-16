const BASE_CURRENCY = "SGD";
const DEFAULT_INPUT_CURRENCY = "CNY";
const STORAGE_KEY = "trip-splitter-local-state";
const DEFAULT_CURRENCIES = {
  AUD: "Australian Dollar",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  CNY: "Chinese Renminbi",
  EUR: "Euro",
  GBP: "British Pound Sterling",
  HKD: "Hong Kong Dollar",
  IDR: "Indonesian Rupiah",
  INR: "Indian Rupee",
  JPY: "Japanese Yen",
  KRW: "South Korean Won",
  MYR: "Malaysian Ringgit",
  PHP: "Philippine Peso",
  SGD: "Singapore Dollar",
  THB: "Thai Baht",
  TWD: "New Taiwan Dollar",
  USD: "US Dollar",
  VND: "Vietnamese Dong",
};

const state = loadState();

const memberForm = document.querySelector("#member-form");
const memberNameInput = document.querySelector("#member-name");
const memberList = document.querySelector("#member-list");
const memberEmpty = document.querySelector("#member-empty");

const expenseForm = document.querySelector("#expense-form");
const expenseTitleInput = document.querySelector("#expense-title");
const expenseAmountInput = document.querySelector("#expense-amount");
const expenseCurrencySelect = document.querySelector("#expense-currency");
const expenseDateInput = document.querySelector("#expense-date");
const paidBySelect = document.querySelector("#expense-paid-by");
const splitModeSelect = document.querySelector("#expense-split-mode");
const participantOptions = document.querySelector("#participant-options");
const customSplitSection = document.querySelector("#custom-split");
const customSplitInputs = document.querySelector("#custom-split-inputs");
const customTotalHint = document.querySelector("#custom-total-hint");
const fxPreview = document.querySelector("#fx-preview");

const balanceList = document.querySelector("#balance-list");
const settlementList = document.querySelector("#settlement-list");
const expenseList = document.querySelector("#expense-list");
const expenseSubmitButton = document.querySelector("#expense-submit-button");
const expenseCancelButton = document.querySelector("#expense-cancel-button");
const resetSliderInput = document.querySelector("#reset-slider-input");
const syncStatus = document.querySelector("#sync-status");
let editingExpenseId = null;

memberForm.addEventListener("submit", handleMemberSubmit);
expenseForm.addEventListener("submit", handleExpenseSubmit);
splitModeSelect.addEventListener("change", renderCustomSplitState);
participantOptions.addEventListener("change", () => {
  renderCustomInputs();
  renderCustomSplitState();
});
customSplitInputs.addEventListener("input", updateCustomTotalHint);
expenseCurrencySelect.addEventListener("change", updateExpenseMetaPreview);
expenseAmountInput.addEventListener("input", updateExpenseMetaPreview);
expenseDateInput.addEventListener("input", updateExpenseMetaPreview);
expenseCancelButton.addEventListener("click", cancelExpenseEdit);
resetSliderInput.addEventListener("input", handleResetSlide);

expenseDateInput.value = todayIsoDate();
render();
loadCurrencies();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      members: Array.isArray(parsed.members) ? parsed.members : [],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      currencies: parsed.currencies && typeof parsed.currencies === "object" ? parsed.currencies : DEFAULT_CURRENCIES,
    };
  } catch {
    return {
      members: [],
      expenses: [],
      currencies: DEFAULT_CURRENCIES,
    };
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      members: state.members,
      expenses: state.expenses,
      currencies: state.currencies,
    })
  );
}

async function loadCurrencies() {
  try {
    const response = await fetch("https://api.frankfurter.app/currencies");
    if (response.ok) {
      const payload = await response.json();
      state.currencies = {
        ...payload,
        [BASE_CURRENCY]: payload[BASE_CURRENCY] || DEFAULT_CURRENCIES[BASE_CURRENCY],
      };
      saveState();
      render();
    }
  } catch {
    setSyncStatus("Local browser storage. FX list fallback in use.", "neutral");
  }
}

async function handleMemberSubmit(event) {
  event.preventDefault();
  const name = memberNameInput.value.trim();
  if (!name) {
    return;
  }

  const duplicate = state.members.some((member) => member.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    alert("That member already exists.");
    return;
  }

  state.members.push({
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  });

  memberForm.reset();
  persistAndRender();
}

async function handleExpenseSubmit(event) {
  event.preventDefault();

  if (state.members.length < 2) {
    alert("Add at least two trip members before recording an expense.");
    return;
  }

  const title = expenseTitleInput.value.trim();
  const amount = Number(expenseAmountInput.value);
  const currencyCode = expenseCurrencySelect.value || DEFAULT_INPUT_CURRENCY;
  const expenseDate = expenseDateInput.value;
  const paidBy = paidBySelect.value;
  const splitMode = splitModeSelect.value;
  const participantIds = getSelectedParticipantIds();

  if (!title || !amount || amount <= 0) {
    alert("Enter a title and a valid total amount.");
    return;
  }

  if (!expenseDate) {
    alert("Choose the date for this expense.");
    return;
  }

  if (!paidBy) {
    alert("Choose who paid the expense.");
    return;
  }

  if (participantIds.length === 0) {
    alert("Choose at least one member to split this expense with.");
    return;
  }

  let shares;
  if (splitMode === "equal") {
    shares = buildEqualShares(participantIds, amount);
  } else {
    shares = buildCustomShares(participantIds, amount);
    if (!shares) {
      return;
    }
  }

  try {
    const fx = await getHistoricalRateToSgd(currencyCode, expenseDate);
    const amountSgd = roundCurrency(amount * fx.rate);
    const sharesWithSgd = buildConvertedShares(shares, fx.rate);

    const nextExpense = {
      id: editingExpenseId || crypto.randomUUID(),
      title,
      amount: roundCurrency(amount),
      amountSgd,
      currencyCode,
      expenseDate,
      fxRateToSgd: fx.rate,
      fxDate: fx.date,
      paidBy,
      splitMode,
      shares: sharesWithSgd,
      participants: sharesWithSgd.map((share) => share.memberId),
      createdAt: editingExpenseId
        ? (state.expenses.find((expense) => expense.id === editingExpenseId)?.createdAt || new Date().toISOString())
        : new Date().toISOString(),
    };

    if (editingExpenseId) {
      state.expenses = state.expenses.map((expense) => expense.id === editingExpenseId ? nextExpense : expense);
    } else {
      state.expenses.unshift(nextExpense);
    }

    clearExpenseForm();
    persistAndRender();
  } catch (error) {
    alert(error.message);
  }
}

function buildEqualShares(participantIds, amount) {
  const totalCents = Math.round(amount * 100);
  const base = Math.floor(totalCents / participantIds.length);
  const remainder = totalCents - base * participantIds.length;

  return participantIds.map((participantId, index) => ({
    memberId: participantId,
    amount: (base + (index < remainder ? 1 : 0)) / 100,
  }));
}

function buildCustomShares(participantIds, amount) {
  const shares = participantIds.map((participantId) => {
    const input = customSplitInputs.querySelector(`[data-member-id="${participantId}"]`);
    return {
      memberId: participantId,
      amount: roundCurrency(Number(input?.value || 0)),
    };
  });

  const total = roundCurrency(shares.reduce((sum, share) => sum + share.amount, 0));
  if (Math.abs(total - roundCurrency(amount)) > 0.009) {
    alert("Custom amounts must add up exactly to the total expense.");
    return null;
  }

  return shares;
}

function buildConvertedShares(shares, rate) {
  const converted = shares.map((share) => ({
    memberId: share.memberId,
    amount: share.amount,
    amountSgd: roundCurrency(share.amount * rate),
  }));

  const targetTotal = roundCurrency(shares.reduce((sum, share) => sum + share.amount, 0) * rate);
  const actualTotal = roundCurrency(converted.reduce((sum, share) => sum + share.amountSgd, 0));
  const delta = roundCurrency(targetTotal - actualTotal);

  if (Math.abs(delta) > 0.009 && converted.length > 0) {
    converted[converted.length - 1].amountSgd = roundCurrency(converted[converted.length - 1].amountSgd + delta);
  }

  return converted;
}

function getSelectedParticipantIds() {
  return [...participantOptions.querySelectorAll("input:checked")].map((input) => input.value);
}

function handleResetSlide() {
  if (Number(resetSliderInput.value) < 100) {
    return;
  }

  const confirmed = window.confirm("Reset all local test data in this browser?");
  if (!confirmed) {
    resetSliderInput.value = "0";
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
  state.members = [];
  state.expenses = [];
  state.currencies = DEFAULT_CURRENCIES;
  clearExpenseForm();
  resetSliderInput.value = "0";
  render();
}

function persistAndRender() {
  saveState();
  render();
}

function render() {
  renderMembers();
  renderExpenseControls();
  renderBalances();
  renderSettlements();
  renderExpenses();
}

function renderMembers() {
  memberList.innerHTML = "";
  memberEmpty.classList.toggle("hidden", state.members.length > 0);

  const template = document.querySelector("#member-chip-template");
  state.members.forEach((member) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector("span").textContent = member.name;
    node.querySelector("button").addEventListener("click", () => removeMember(member.id));
    memberList.appendChild(node);
  });
}

function renderExpenseControls() {
  const canAddExpense = state.members.length >= 2;
  const activeTitle = expenseTitleInput.value || "";
  const activeAmount = expenseAmountInput.value || "";
  const activeDate = expenseDateInput.value || todayIsoDate();
  const activeCurrency = expenseCurrencySelect.value || DEFAULT_INPUT_CURRENCY;
  const activePaidBy = paidBySelect.value || "";
  const activeParticipants = getSelectedParticipantIds();
  const activeCustomShares = Object.fromEntries(
    [...customSplitInputs.querySelectorAll("input[data-member-id]")].map((input) => [input.dataset.memberId, input.value])
  );
  const activeSplitMode = splitModeSelect.value || "equal";

  expenseTitleInput.disabled = !canAddExpense;
  expenseAmountInput.disabled = !canAddExpense;
  expenseCurrencySelect.disabled = !canAddExpense;
  expenseDateInput.disabled = !canAddExpense;
  paidBySelect.disabled = !canAddExpense;
  splitModeSelect.disabled = !canAddExpense;
  expenseForm.querySelector("button[type='submit']").disabled = !canAddExpense;

  expenseCurrencySelect.innerHTML = Object.entries(state.currencies)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, name]) => `<option value="${code}">${code} - ${escapeHtml(name)}</option>`)
    .join("");
  expenseCurrencySelect.value = state.currencies[activeCurrency] ? activeCurrency : DEFAULT_INPUT_CURRENCY;
  expenseTitleInput.value = activeTitle;
  expenseAmountInput.value = activeAmount;
  expenseDateInput.value = activeDate;
  splitModeSelect.value = activeSplitMode;
  expenseSubmitButton.textContent = editingExpenseId ? "Update expense" : "Save expense";
  expenseCancelButton.classList.toggle("hidden", !editingExpenseId);

  paidBySelect.innerHTML = state.members.length
    ? state.members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}</option>`).join("")
    : `<option value="">Add members first</option>`;
  paidBySelect.value = state.members.some((member) => member.id === activePaidBy)
    ? activePaidBy
    : (state.members[0]?.id || "");

  const selectedParticipants = new Set(
    activeParticipants.length ? activeParticipants : state.members.map((member) => member.id)
  );
  participantOptions.innerHTML = state.members
    .map((member) => `
      <label class="check-item">
        <input type="checkbox" value="${member.id}" ${selectedParticipants.has(member.id) ? "checked" : ""}>
        <span>${escapeHtml(member.name)}</span>
      </label>
    `)
    .join("");

  renderCustomInputs();
  Object.entries(activeCustomShares).forEach(([memberId, amount]) => {
    const input = customSplitInputs.querySelector(`[data-member-id="${memberId}"]`);
    if (input) {
      input.value = amount;
    }
  });
  renderCustomSplitState();
  updateExpenseMetaPreview();
}

function renderCustomInputs() {
  const participantIds = getSelectedParticipantIds();
  customSplitInputs.innerHTML = participantIds
    .map((participantId) => {
      const member = state.members.find((entry) => entry.id === participantId);
      return `
        <label>
          ${escapeHtml(member?.name || "")}
          <input
            type="number"
            min="0"
            step="0.01"
            value=""
            data-member-id="${participantId}"
            placeholder="0.00"
          >
        </label>
      `;
    })
    .join("");
  updateCustomTotalHint();
}

function renderCustomSplitState() {
  customSplitSection.classList.toggle("hidden", splitModeSelect.value !== "custom");
}

function renderBalances() {
  const balances = computeBalances();
  balanceList.innerHTML = "";

  if (state.members.length === 0) {
    balanceList.innerHTML = `<div class="empty-state">Balances will appear after you add trip members.</div>`;
    return;
  }

  balances.forEach(({ memberId, amount }) => {
    const member = findMember(memberId);
    balanceList.insertAdjacentHTML(
      "beforeend",
      `
        <div class="summary-item">
          <strong>${escapeHtml(member.name)}</strong>
          <span class="${amount >= 0 ? "positive" : "negative"}">${amount >= 0 ? "is owed" : "owes"} ${formatCurrency(Math.abs(amount), BASE_CURRENCY)}</span>
        </div>
      `
    );
  });
}

function renderSettlements() {
  const settlements = simplifyDebts(computeBalances());
  settlementList.innerHTML = settlements.length
    ? settlements.map((settlement) => `
        <div class="summary-item">
          <strong>${escapeHtml(findMember(settlement.from).name)}</strong>
          <span>pays ${escapeHtml(findMember(settlement.to).name)} ${formatCurrency(settlement.amount, BASE_CURRENCY)}</span>
        </div>
      `).join("")
    : `<div class="empty-state">No repayments needed yet.</div>`;
}

function renderExpenses() {
  expenseList.innerHTML = state.expenses.length
    ? state.expenses.map((expense) => {
        const payer = findMember(expense.paidBy);
        const splitSummary = expense.shares
          .map((share) => `${findMember(share.memberId).name}: ${formatCurrency(share.amount, expense.currencyCode)} (${formatCurrency(share.amountSgd, BASE_CURRENCY)})`)
          .join(" | ");
        const convertedNote = expense.currencyCode === BASE_CURRENCY
          ? `Settles directly in ${BASE_CURRENCY}`
          : `${formatCurrency(expense.amount, expense.currencyCode)} -> ${formatCurrency(expense.amountSgd, BASE_CURRENCY)} at ${expense.fxRateToSgd.toFixed(4)} on ${expense.fxDate}`;

        return `
          <article class="expense-card">
            <div class="expense-card-header">
              <div>
                <h3>${escapeHtml(expense.title)}</h3>
                <p>${escapeHtml(payer.name)} paid ${formatCurrency(expense.amount, expense.currencyCode)} (${formatCurrency(expense.amountSgd, BASE_CURRENCY)})</p>
              </div>
              <small>${formatDate(expense.expenseDate || expense.createdAt)}</small>
            </div>
            <div class="expense-card-meta">
              <p>${expense.splitMode === "equal" ? "Equal split" : "Custom split"}</p>
              <p>${escapeHtml(convertedNote)}</p>
            </div>
            <p>${escapeHtml(splitSummary)}</p>
            <div class="expense-card-actions">
              <button type="button" class="ghost-button" data-edit-expense-id="${expense.id}">Edit</button>
            </div>
          </article>
        `;
      }).join("")
    : `<div class="empty-state">Your expense history will appear here.</div>`;

  expenseList.querySelectorAll("[data-edit-expense-id]").forEach((button) => {
    button.addEventListener("click", () => startExpenseEdit(button.dataset.editExpenseId));
  });
}

function removeMember(memberId) {
  const used = state.expenses.some((expense) => expense.paidBy === memberId || expense.participants.includes(memberId));
  if (used) {
    alert("This member is already used in recorded expenses and cannot be removed.");
    return;
  }

  state.members = state.members.filter((member) => member.id !== memberId);
  persistAndRender();
}

function computeBalances() {
  const balances = new Map(state.members.map((member) => [member.id, 0]));
  state.expenses.forEach((expense) => {
    balances.set(expense.paidBy, roundCurrency((balances.get(expense.paidBy) || 0) + expense.amountSgd));
    expense.shares.forEach((share) => {
      balances.set(share.memberId, roundCurrency((balances.get(share.memberId) || 0) - share.amountSgd));
    });
  });

  return [...balances.entries()]
    .map(([memberId, amount]) => ({ memberId, amount: roundCurrency(amount) }))
    .sort((left, right) => right.amount - left.amount);
}

function simplifyDebts(balances) {
  const creditors = balances.filter((entry) => entry.amount > 0.009).map((entry) => ({ ...entry }));
  const debtors = balances.filter((entry) => entry.amount < -0.009).map((entry) => ({
    memberId: entry.memberId,
    amount: Math.abs(entry.amount),
  }));

  const settlements = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = roundCurrency(Math.min(creditor.amount, debtor.amount));

    settlements.push({ from: debtor.memberId, to: creditor.memberId, amount });
    creditor.amount = roundCurrency(creditor.amount - amount);
    debtor.amount = roundCurrency(debtor.amount - amount);

    if (creditor.amount <= 0.009) {
      creditorIndex += 1;
    }
    if (debtor.amount <= 0.009) {
      debtorIndex += 1;
    }
  }

  return settlements;
}

function updateCustomTotalHint() {
  const total = [...customSplitInputs.querySelectorAll("input")].reduce((sum, input) => sum + Number(input.value || 0), 0);
  customTotalHint.textContent = `Total assigned: ${formatCurrency(total, expenseCurrencySelect.value || DEFAULT_INPUT_CURRENCY)}`;
}

function updateExpenseMetaPreview() {
  const amount = Number(expenseAmountInput.value || 0);
  const currencyCode = expenseCurrencySelect.value || DEFAULT_INPUT_CURRENCY;
  const expenseDate = expenseDateInput.value || todayIsoDate();

  if (!amount) {
    fxPreview.textContent = `Settlement base: ${BASE_CURRENCY}. Historical rate for ${currencyCode} on ${expenseDate} will be applied when you save.`;
    updateCustomTotalHint();
    return;
  }

  if (currencyCode === BASE_CURRENCY) {
    fxPreview.textContent = `Settlement base: ${BASE_CURRENCY}. ${formatCurrency(amount, BASE_CURRENCY)} stays ${formatCurrency(amount, BASE_CURRENCY)}.`;
  } else {
    fxPreview.textContent = `Settlement base: ${BASE_CURRENCY}. ${formatCurrency(amount, currencyCode)} will use the ${expenseDate} historical rate when you save.`;
  }

  updateCustomTotalHint();
}

async function getHistoricalRateToSgd(currencyCode, expenseDate) {
  if (currencyCode === BASE_CURRENCY) {
    return { rate: 1, date: expenseDate };
  }

  const url = new URL(`https://api.frankfurter.app/${expenseDate}`);
  url.searchParams.set("from", currencyCode);
  url.searchParams.set("to", BASE_CURRENCY);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load the ${expenseDate} exchange rate for ${currencyCode}.`);
  }

  const payload = await response.json();
  const rate = Number(payload?.rates?.[BASE_CURRENCY]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`No ${BASE_CURRENCY} rate was returned for ${currencyCode} on ${expenseDate}.`);
  }

  return { rate, date: String(payload.date || expenseDate) };
}

function findMember(memberId) {
  return state.members.find((member) => member.id === memberId) || { name: "Unknown member" };
}

function startExpenseEdit(expenseId) {
  const expense = state.expenses.find((entry) => entry.id === expenseId);
  if (!expense) {
    return;
  }

  editingExpenseId = expenseId;
  expenseTitleInput.value = expense.title;
  expenseAmountInput.value = expense.amount;
  expenseCurrencySelect.value = expense.currencyCode || DEFAULT_INPUT_CURRENCY;
  expenseDateInput.value = expense.expenseDate || todayIsoDate();
  paidBySelect.value = expense.paidBy;
  splitModeSelect.value = expense.splitMode;

  participantOptions.querySelectorAll("input").forEach((input) => {
    input.checked = expense.participants.includes(input.value);
  });

  renderExpenseControls();
  Object.entries(Object.fromEntries(expense.shares.map((share) => [share.memberId, share.amount]))).forEach(([memberId, amount]) => {
    const input = customSplitInputs.querySelector(`[data-member-id="${memberId}"]`);
    if (input) {
      input.value = amount;
    }
  });
  renderCustomSplitState();
  updateExpenseMetaPreview();
  expenseTitleInput.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelExpenseEdit() {
  clearExpenseForm();
  render();
}

function clearExpenseForm() {
  editingExpenseId = null;
  expenseForm.reset();
  splitModeSelect.value = "equal";
  expenseCurrencySelect.value = DEFAULT_INPUT_CURRENCY;
  expenseDateInput.value = todayIsoDate();
  resetSliderInput.value = "0";
  renderExpenseControls();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatCurrency(value, currencyCode) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(roundCurrency(value));
  } catch {
    return `${currencyCode} ${roundCurrency(value).toFixed(2)}`;
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function setSyncStatus(message, tone) {
  syncStatus.textContent = message;
  syncStatus.dataset.tone = tone;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
