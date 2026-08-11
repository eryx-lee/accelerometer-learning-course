import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ANSWER_KEY_VERSION, QUESTION_BANK } from "../functions/_shared/question-bank.ts";

test("server question bank contains the published 22 quizzes and 57 questions", () => {
  assert.equal(Object.keys(QUESTION_BANK).length, 22);
  assert.equal(
    Object.values(QUESTION_BANK).reduce((total, quiz) => total + Object.keys(quiz.answers).length, 0),
    57,
  );
  assert.equal(ANSWER_KEY_VERSION, "1.3.0-20260811");
});

test("server answer keys exactly match every published scored quiz", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const quarto = `${root}/quarto`;
  const source = readdirSync(quarto)
    .filter((name) => name.endsWith(".qmd"))
    .map((name) => readFileSync(`${quarto}/${name}`, "utf8"))
    .join("\n");

  const published = {};
  const forms = source.matchAll(
    /<form class="scored-quiz"[^>]*data-quiz-id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/gu,
  );
  for (const form of forms) {
    const answers = {};
    for (const fieldset of form[2].matchAll(
      /<fieldset data-answer="([a-d])"[^>]*>([\s\S]*?)<\/fieldset>/gu,
    )) {
      const name = fieldset[2].match(/<input[^>]*name="([^"]+)"/u)?.[1];
      assert.ok(name, `Missing radio name in ${form[1]}`);
      answers[name] = fieldset[1];
    }
    published[form[1]] = answers;
  }

  assert.deepEqual(
    Object.fromEntries(Object.entries(QUESTION_BANK).map(([id, quiz]) => [id, quiz.answers])),
    published,
  );
});
