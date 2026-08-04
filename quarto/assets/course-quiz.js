(() => {
  "use strict";

  const quizzes = Array.from(document.querySelectorAll(".scored-quiz"));
  if (!quizzes.length) return;

  const quizStoragePrefix = "accelerometer-quiz-v2:";
  const finalQuizStorageKey = "accelerometer-final-quiz-v2";

  const readStorage = (key) => {
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[storageName];
        const value = JSON.parse(storage.getItem(key));
        if (value && typeof value === "object") return value;
      } catch (_error) {
        // Try the next storage mechanism.
      }
    }
    return null;
  };

  const writeStorage = (key, value) => {
    let saved = false;
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[storageName];
        storage.setItem(key, JSON.stringify(value));
        saved = true;
      } catch (_error) {
        // Try the next storage mechanism.
      }
    }
    return saved;
  };

  const removeStorage = (key) => {
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[storageName];
        storage.removeItem(key);
      } catch (_error) {
        // Try the next storage mechanism.
      }
    }
  };

  const getFinalQuizStatus = () => readStorage(finalQuizStorageKey);
  window.AccelerometerCourseQuiz = Object.freeze({
    finalQuizStorageKey,
    getFinalQuizStatus
  });

  const publishFinalQuizStatus = (status) => {
    if (status) {
      writeStorage(finalQuizStorageKey, status);
    } else {
      removeStorage(finalQuizStorageKey);
    }
    window.dispatchEvent(new CustomEvent("accelerometer:final-quiz-status", { detail: status }));
    window.dispatchEvent(new CustomEvent("course-state-changed"));
  };

  const clearQuestionState = (question) => {
    question.classList.remove("is-correct", "needs-review", "is-unanswered");
    const feedback = question.querySelector(".scored-quiz__feedback");
    if (feedback) {
      feedback.hidden = true;
      feedback.textContent = "";
    }
    question.querySelectorAll("input").forEach((input) => input.removeAttribute("aria-invalid"));
  };

  const getQuestionKey = (question, index) =>
    question.querySelector('input[type="radio"]')?.name || `question-${index + 1}`;

  const collectAnswers = (questions) => Object.fromEntries(
    questions.map((question, index) => [
      getQuestionKey(question, index),
      question.querySelector('input[type="radio"]:checked')?.value || null
    ])
  );

  quizzes.forEach((quiz, quizIndex) => {
    const questions = Array.from(quiz.querySelectorAll("[data-answer]"));
    const score = quiz.querySelector(".scored-quiz__score");
    if (!questions.length || !score) return;

    const quizId = quiz.dataset.quizId || `page-${quizIndex + 1}`;
    const storageKey = `${quizStoragePrefix}${quizId}`;
    const passScoreValue = Number.parseInt(quiz.dataset.passScore || "", 10);
    const passScore = Number.isFinite(passScoreValue) ? passScoreValue : null;
    const isFinalQuiz = quiz.dataset.finalQuiz === "true";

    const saveDraft = () => {
      const answers = collectAnswers(questions);
      writeStorage(storageKey, {
        quizId,
        answers,
        score: null,
        total: questions.length,
        passed: false,
        complete: false,
        checkedAt: null,
        completedAt: null
      });
      if (isFinalQuiz) publishFinalQuizStatus(null);
    };

    const evaluate = ({ focus = true, persist = true, timestamp = null } = {}) => {
      let correct = 0;
      let firstUnanswered = null;

      questions.forEach((question, index) => {
        clearQuestionState(question);
        const selected = question.querySelector('input[type="radio"]:checked');
        const feedback = question.querySelector(".scored-quiz__feedback");
        const explanation = question.dataset.explanation || "";

        if (!selected) {
          question.classList.add("is-unanswered");
          question.querySelectorAll("input").forEach((input) => input.setAttribute("aria-invalid", "true"));
          if (feedback) {
            feedback.textContent = `Question ${index + 1}: choose one answer, then check again.`;
          }
          firstUnanswered ||= question.querySelector("input");
        } else if (selected.value === question.dataset.answer) {
          correct += 1;
          question.classList.add("is-correct");
          if (feedback) feedback.textContent = `Correct. ${explanation}`;
        } else {
          question.classList.add("needs-review");
          if (feedback) feedback.textContent = `Review this one. ${explanation}`;
        }
        if (feedback) feedback.hidden = false;
      });

      const answers = collectAnswers(questions);
      const unanswered = Object.values(answers).filter((answer) => !answer).length;
      const complete = unanswered === 0;
      const effectivePassScore = passScore ?? questions.length;
      const passed = complete && correct >= effectivePassScore;
      const completedAt = complete ? (timestamp || new Date().toISOString()) : null;
      const guidance = unanswered
        ? `${unanswered} unanswered. Complete every item for a final score.`
        : passScore !== null && passed
          ? `You met the suggested ${passScore}/${questions.length} checkpoint. Review any missed explanations before continuing.`
          : passScore !== null
            ? `Review the missed explanations, then retry the suggested ${passScore}/${questions.length} checkpoint.`
            : "Review the feedback for every item before continuing.";

      score.textContent = `Score: ${correct} of ${questions.length}. ${guidance}`;
      score.hidden = false;

      if (persist) {
        const checkedAt = new Date().toISOString();
        writeStorage(storageKey, {
          quizId,
          answers,
          score: correct,
          total: questions.length,
          passed,
          complete,
          checkedAt,
          completedAt
        });

        if (isFinalQuiz) {
          if (complete) {
            publishFinalQuizStatus({
              score: correct,
              total: questions.length,
              passed: correct >= 6,
              completedAt
            });
          } else {
            publishFinalQuizStatus(null);
          }
        }
      }

      if (focus) (firstUnanswered || score).focus({ preventScroll: false });
    };

    quiz.addEventListener("change", (event) => {
      const question = event.target.closest("[data-answer]");
      if (!question || !quiz.contains(question)) return;
      clearQuestionState(question);
      score.hidden = true;
      score.textContent = "";
      saveDraft();
    });

    quiz.addEventListener("submit", (event) => {
      event.preventDefault();
      evaluate();
    });

    quiz.addEventListener("reset", () => {
      window.setTimeout(() => {
        questions.forEach(clearQuestionState);
        score.hidden = true;
        score.textContent = "";
        removeStorage(storageKey);
        if (isFinalQuiz) publishFinalQuizStatus(null);
        quiz.querySelector("input")?.focus({ preventScroll: false });
      }, 0);
    });

    const stored = readStorage(storageKey);
    if (!stored) return;

    questions.forEach((question, index) => {
      const savedValue = stored.answers?.[getQuestionKey(question, index)];
      if (!savedValue) return;
      const matchingInput = Array.from(question.querySelectorAll('input[type="radio"]'))
        .find((input) => input.value === savedValue);
      if (matchingInput) matchingInput.checked = true;
    });

    if (stored.checkedAt) {
      evaluate({ focus: false, persist: false, timestamp: stored.completedAt || stored.checkedAt });
    }
  });
})();
