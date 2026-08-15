const getJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Something went wrong.");
  }
  return payload;
};

const asArray = (value) => Array.isArray(value) ? value : [];
const safeText = (value) => (typeof value === "string" ? value.trim() : "");

const state = {
  hasStarted: false,
  startedAt: null,
  completedAt: null,
  solvedQuestionsCount: 0,
  totalQuestions: 0,
  solvedQuestionIds: [],
  attemptsByQuestion: {},
  wrongAnswersByQuestion: {},
  hintsUsed: {},
  unlockedClues: [],
  finalAnswerAttempts: 0,
  finalCorrectAt: null,
  totalQuestions: 0,
};

let currentQuestion = null;
let timerHandle = null;

const page = document.body.dataset.page;

if (page !== "game") {
  console.log("Operation: Secret location is active.");
}

const setFeedback = (message, variant = "warning") => {
  const feedback = document.querySelector("#feedback");
  if (!feedback) return;

  feedback.hidden = false;
  feedback.className = `alert alert-${variant}`;
  feedback.textContent = message;
};

const hideFeedback = () => {
  const feedback = document.querySelector("#feedback");
  if (!feedback) return;
  feedback.hidden = true;
  feedback.textContent = "";
};

const renderClueBoard = () => {
  const board = document.querySelector("#clue-board");
  if (!board) return;

  board.innerHTML = "";
  const slots = Math.max(state.totalQuestions || 0, state.unlockedClues.length);

  const clues = asArray(state.unlockedClues).map((value, index) => ({
    value,
    index,
  }));

  clues.forEach((clue) => {
    const tile = document.createElement("div");
    tile.className = "clue-tile";
    tile.textContent = clue.value || "?";
    tile.draggable = true;
    tile.dataset.index = String(clue.index);
    board.appendChild(tile);
  });

  if (slots > clues.length) {
    for (let i = 0; i < slots - clues.length; i += 1) {
      const tile = document.createElement("div");
      tile.className = "clue-tile locked";
      tile.textContent = "?";
      board.appendChild(tile);
    }
  }

  const onDragStart = (event) => {
    if (!event.target.classList.contains("clue-tile") || event.target.classList.contains("locked")) {
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", event.target.dataset.index ?? "0");
    event.target.classList.add("dragging");
  };

  const onDragOver = (event) => {
    event.preventDefault();
  };

  const onDrop = (event) => {
    event.preventDefault();
    const sourceRaw = event.dataTransfer.getData("text/plain");
    const source = Number.parseInt(sourceRaw, 10);
    const targetTile = event.target?.closest?.(".clue-tile");
    const target = Number.parseInt(targetTile?.dataset?.index ?? "-1", 10);
    if (Number.isNaN(source) || Number.isNaN(target)) {
      return;
    }

    const tiles = asArray(Array.from(board.querySelectorAll(".clue-tile:not(.locked)")));
    const payload = tiles.map((tile) => tile.textContent || "");
    const [moving] = payload.splice(source, 1);
    payload.splice(target, 0, moving);
    state.unlockedClues = payload;
    renderClueBoard();
  };

  board.addEventListener("dragstart", onDragStart);
  board.addEventListener("dragover", onDragOver);
  board.addEventListener("drop", onDrop);
};

const renderProgress = () => {
  const solved = document.querySelector("#solved-count");
  const total = document.querySelector("#total-count");
  const finalAttempts = document.querySelector("#final-attempts");
  const startedAt = document.querySelector("#started-at");

  if (solved) solved.textContent = String(state.solvedQuestionsCount);
  if (total) total.textContent = String(state.totalQuestions);
  if (finalAttempts) finalAttempts.textContent = String(state.finalAnswerAttempts);
  if (startedAt) startedAt.textContent = state.startedAt ? new Date(state.startedAt).toLocaleString("en-GB", { timeZone: "Europe/Sofia" }) : "not started";
  renderClueBoard();
};

const renderTimer = () => {
  const target = document.querySelector("#elapsed-timer");
  if (!target) return;

  if (!state.startedAt) {
    target.textContent = "00:00";
    return;
  }

  const started = new Date(state.startedAt).getTime();

  const update = () => {
    const diff = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    target.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  update();
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(update, 1000);
};

const renderQuestion = () => {
  const section = document.querySelector("#answer-form-container");
  const hintContainer = document.querySelector("#hint-wrap");
  const finalForm = document.querySelector("#final-form-wrap");
  const finalSuccess = document.querySelector("#success-screen");
  const qWrap = document.querySelector("#question-wrapper");
  if (!qWrap || !section) return;

  section.innerHTML = "";
  hintContainer.innerHTML = "";

  finalForm.classList.add("hidden");
  finalSuccess.classList.add("hidden");

  if (state.completedAt || state.solvedQuestionsCount === state.totalQuestions) {
    finalForm.classList.remove("hidden");
    if (state.completedAt) {
      finalSuccess.classList.remove("hidden");
    }
    return;
  }

  if (!currentQuestion) {
    qWrap.textContent = "No question available.";
    return;
  }

  const title = document.createElement("h3");
  title.textContent = currentQuestion.question;
  section.appendChild(title);

  const hintInfo = document.createElement("p");
  if (currentQuestion.hintUsed && currentQuestion.hint) {
    hintInfo.textContent = `Hint: ${currentQuestion.hint}`;
    section.appendChild(hintInfo);
  }
  if (currentQuestion.hintAvailable) {
    const hintButton = document.createElement("button");
    hintButton.type = "button";
    hintButton.className = "btn btn-secondary";
    hintButton.textContent = "Hint";
    hintButton.addEventListener("click", async () => {
      try {
        const response = await getJson(`/api/game/question/${currentQuestion.id}/hint`, {
          method: "POST",
        });
        if (response.hint) {
          currentQuestion.hint = response.hint;
          currentQuestion.hintUsed = true;
          renderQuestion();
          setFeedback(response.alreadyUsed ? "Hint was already used." : "Hint is unlocked.", "warning");
        } else {
          setFeedback("No hint is available for this question.", "warning");
        }
      } catch (error) {
        setFeedback(error.message, "error");
      }
    });
    hintContainer.appendChild(hintButton);
  }

  if (currentQuestion.type === "singleChoice") {
    currentQuestion.options?.forEach((option, index) => {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "answer";
      radio.value = option;
      label.appendChild(radio);
      label.append(` ${option}`);
      section.appendChild(label);
      section.appendChild(document.createElement("br"));
    });
  }

  if (currentQuestion.type === "multipleChoice") {
    currentQuestion.options?.forEach((option, index) => {
      const label = document.createElement("label");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.name = "answer";
      check.value = option;
      label.appendChild(check);
      label.append(` ${option}`);
      section.appendChild(label);
      section.appendChild(document.createElement("br"));
    });
  }

  if (currentQuestion.type === "text") {
    const input = document.createElement("input");
    input.type = "text";
    input.name = "answer";
    input.autocomplete = "off";
    section.appendChild(input);
  }

  const submitWrap = document.createElement("div");
  submitWrap.className = "form-actions";

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "btn";
  submit.textContent = "Submit answer";
  submit.addEventListener("click", async () => {
    const payload = collectAnswer();
    if (!payload.found) {
      setFeedback("Select or enter an answer.", "warning");
      return;
    }

    try {
      hideFeedback();
      const response = await getJson(`/api/game/question/${currentQuestion.id}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer: payload.answer }),
      });

      await loadProgress();
      await loadQuestion();
      if (response.correct) {
        if (response.newlyUnlockedClue) {
          setFeedback(`Unlocked fragment: ${response.newlyUnlockedClue}`, "success");
        } else {
          setFeedback("Correct answer.", "success");
        }
      } else {
        setFeedback(response.message, "warning");
      }
    } catch (error) {
      setFeedback(error.message, "error");
    }
  });

  submitWrap.appendChild(submit);
  section.appendChild(submitWrap);
};

const collectAnswer = () => {
  const form = document.querySelector("#answer-form-container");
  if (!form) return { found: false };

  const text = form.querySelector("input[name='answer']:not([type='checkbox']):not([type='radio'])");
  if (text) {
    const value = safeText(text.value);
    return { found: value.length > 0, answer: value };
  }

  const checked = Array.from(form.querySelectorAll("input[type='checkbox']:checked")).map((item) => item.value);
  if (checked.length > 0) {
    return { found: true, answer: checked };
  }

  const selected = form.querySelector("input[type='radio']:checked");
  if (selected) {
    return { found: true, answer: selected.value };
  }

  return { found: false };
};

const loadProgress = async () => {
  const progress = await getJson("/api/game/progress");
  state.hasStarted = progress.hasStarted;
  state.startedAt = progress.startedAt;
  state.completedAt = progress.completedAt;
  state.currentQuestionId = progress.currentQuestionId;
  state.solvedQuestionIds = progress.solvedQuestionIds || [];
  state.attemptsByQuestion = progress.attemptsByQuestion || {};
  state.wrongAnswersByQuestion = progress.wrongAnswersByQuestion || {};
  state.hintsUsed = progress.hintsUsed || {};
  state.unlockedClues = progress.unlockedClues || [];
  state.finalAnswerAttempts = progress.finalAnswerAttempts || 0;
  state.finalCorrectAt = progress.finalCorrectAt || null;
  state.totalQuestions = progress.totalQuestions || 0;
  state.solvedQuestionsCount = progress.solvedQuestionsCount || 0;

  renderProgress();
  renderTimer();
};

const loadQuestion = async () => {
  const response = await getJson("/api/game/question");
  if (!response.question) {
    currentQuestion = null;
    renderQuestion();
    return;
  }

  currentQuestion = response.question;
  renderQuestion();
};

const initFinalGuess = () => {
  const form = document.querySelector("#final-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const input = form.querySelector("#final-answer");
    const answer = safeText(input?.value);
    if (!answer) {
      setFeedback("Enter your location guess.", "warning");
      return;
    }

    try {
      const response = await getJson("/api/game/final-answer", {
        method: "POST",
        body: JSON.stringify({ answer }),
      });
      await loadProgress();
      renderQuestion();
      if (response.correct) {
        const success = document.querySelector("#success-time");
        if (success) success.textContent = response.finalTimeMs
          ? `${Math.floor(response.finalTimeMs / 1000)} seconds`
          : "-";
        setFeedback("Congratulations! The mission is revealed.", "success");
      } else {
        setFeedback("That is not the correct location answer.", "error");
      }
    } catch (error) {
      setFeedback(error.message, "error");
    }
  });
};

if (page === "game") {
  const init = async () => {
    try {
      await loadProgress();
      await loadQuestion();
      initFinalGuess();
    } catch (error) {
      setFeedback(error.message, "error");
    }
  };
  init();
}
