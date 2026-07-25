(() => {
  "use strict";

  const quiz = document.querySelector(".scored-quiz");
  if (!quiz) return;

  const questions = Array.from(quiz.querySelectorAll("[data-answer]"));
  const score = quiz.querySelector(".scored-quiz__score");
  const storageKey = "accelerometer-final-quiz-v1";

  const clearQuestionState = (question) => {
    question.classList.remove("is-correct", "needs-review", "is-unanswered");
    const feedback = question.querySelector(".scored-quiz__feedback");
    if (feedback) {
      feedback.hidden = true;
      feedback.textContent = "";
    }
    question.querySelectorAll("input").forEach((input) => input.removeAttribute("aria-invalid"));
  };

  quiz.addEventListener("change", (event) => {
    const question = event.target.closest("[data-answer]");
    if (question) clearQuestionState(question);
  });

  quiz.addEventListener("submit", (event) => {
    event.preventDefault();
    let correct = 0;
    let firstUnanswered = null;

    questions.forEach((question, index) => {
      clearQuestionState(question);
      const selected = question.querySelector("input:checked");
      const feedback = question.querySelector(".scored-quiz__feedback");
      const explanation = question.dataset.explanation || "";

      if (!selected) {
        question.classList.add("is-unanswered");
        question.querySelectorAll("input").forEach((input) => input.setAttribute("aria-invalid", "true"));
        feedback.textContent = `Question ${index + 1}: choose one answer, then check again.`;
        firstUnanswered ||= question.querySelector("input");
      } else if (selected.value === question.dataset.answer) {
        correct += 1;
        question.classList.add("is-correct");
        feedback.textContent = `Correct. ${explanation}`;
      } else {
        question.classList.add("needs-review");
        feedback.textContent = `Review this one. ${explanation}`;
      }
      feedback.hidden = false;
    });

    const unanswered = questions.length - questions.filter((question) =>
      question.querySelector("input:checked")
    ).length;
    const guidance = unanswered
      ? `${unanswered} unanswered. Complete every item for a final score.`
      : correct >= 6
        ? "You met the suggested 6/8 checkpoint. Review any missed explanations before the capstone."
        : "Review the missed explanations and the linked modules, then retry.";

    score.textContent = `Score: ${correct} of ${questions.length}. ${guidance}`;
    score.hidden = false;

    if (!unanswered) {
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ score: correct, total: questions.length, checkedAt: new Date().toISOString() })
        );
      } catch (_error) {
        // The quiz remains fully usable when browser storage is unavailable.
      }
    }

    (firstUnanswered || score).focus({ preventScroll: false });
  });

  quiz.addEventListener("reset", () => {
    window.setTimeout(() => {
      questions.forEach(clearQuestionState);
      score.hidden = true;
      score.textContent = "";
      quiz.querySelector("input")?.focus({ preventScroll: false });
    }, 0);
  });
})();
