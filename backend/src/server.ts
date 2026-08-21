import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import db, { saveStudentProgress } from "./database";

dotenv.config();

const app: FastifyInstance = Fastify({
  logger: true,
});

const port = Number(process.env.PORT || 3001);

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.error("❌ GROQ_API_KEY is missing in backend/.env");
  process.exit(1);
}

const groq = new Groq({
  apiKey,
});

type Difficulty = "easy" | "medium" | "hard";
type SkillLevel = "beginner" | "developing" | "proficient" | "advanced";

type Student = {
  id: string;
  total_attempts: number;
  correct_answers: number;
  accuracy: number;
  current_streak: number;
  best_streak: number;
  skill_level: string;
  current_difficulty: string;
  last_recommendation: string;
};

type TopicProgress = {
  topic: string;
  attempts: number;
  correct: number;
  accuracy: number;
};

type AnalyzeBody = {
  studentId?: string;
  question: string;
  options?: string[];
  correctAnswer: string;
  studentAnswer: string;
  topic?: string;
  difficulty?: string;
  previousPerformance?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatBody = {
  studentId?: string;
  message: string;
  history?: ChatMessage[]; // prior turns of this conversation, sent by the frontend
};

type GenerateQuestionBody = {
  studentId?: string;
  subject?: string;
  level?: string;
  topic?: string;
  difficulty?: string;
  previousQuestions?: string[]; // questions already shown this session (may not be answered yet)
};

type GeneratedQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  subject: string;
  level: string;
  topic: string;
  difficulty: string;
};

type AgentResult = {
  correct?: boolean;
  skillLevel?: string;
  feedback?: string;
  correctAnswer?: string;
  explanation?: string;
  mistake?: string;
  nextDifficulty?: string;
  recommendation?: string;
  nextTopic?: string;
  agentDecision?: string;
  action?: string;
  progress?: {
    weakTopics?: string[];
    strongTopics?: string[];
  };
};

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeAnswer(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeQuestionText(value: string): string {
  // Looser than normalizeAnswer: strips punctuation too, so near-identical
  // rewrites of the same question (extra comma, changed casing) still match.
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, "")
    .replace(/\s+/g, " ");
}

function calculateAccuracy(correctAnswers: number, totalAttempts: number): number {
  if (totalAttempts <= 0) {
    return 0;
  }
  return Number(((correctAnswers / totalAttempts) * 100).toFixed(2));
}

function isDifficulty(value: string): value is Difficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

function isSkillLevel(value: string): value is SkillLevel {
  return (
    value === "beginner" ||
    value === "developing" ||
    value === "proficient" ||
    value === "advanced"
  );
}

function getFallbackDifficulty(currentDifficulty: string, isCorrect: boolean): Difficulty {
  const current: Difficulty = isDifficulty(currentDifficulty) ? currentDifficulty : "easy";
  if (!isCorrect) {
    if (current === "hard") return "medium";
    return "easy";
  }
  if (current === "easy") return "medium";
  if (current === "medium") return "hard";
  return "hard";
}

function getFallbackSkillLevel(accuracy: number): SkillLevel {
  if (accuracy >= 85) return "advanced";
  if (accuracy >= 70) return "proficient";
  if (accuracy >= 40) return "developing";
  return "beginner";
}

async function startServer(): Promise<void> {
  try {
    await app.register(cors, { origin: true });

    app.get("/", async () => {
      return {
        name: "AceLearn AI",
        message: "AI Study Agent backend is running",
        status: "online",
        health: "/health",
      };
    });

    app.get("/health", async () => {
      return {
        ok: true,
        service: "AceLearn AI Agent",
        status: "online",
        database: "connected",
      };
    });

    app.post(
      "/api/agent/generate-question",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const body = (request.body || {}) as GenerateQuestionBody;
          const studentId = body.studentId?.trim() || "demo-student";
          const subject = body.subject?.trim() || "Mathematics";
          const level = body.level?.trim() || "JEE Main";
          const topic = body.topic?.trim() || "General";
          const difficulty = body.difficulty?.trim() || "medium";

          // Questions already ANSWERED (from DB) — the old source, but it
          // lags one full cycle behind because a question only lands here
          // after the student submits an answer.
          const answeredRows = db
            .prepare(
              `SELECT question FROM attempts WHERE student_id = ? ORDER BY id DESC LIMIT 30`,
            )
            .all(studentId) as { question: string }[];

          // Questions already SHOWN this session, even if not yet answered
          // — sent by the frontend. This closes the gap that was causing
          // the same question to appear twice in a row.
          const shownThisSession = Array.isArray(body.previousQuestions)
            ? body.previousQuestions.filter((q): q is string => typeof q === "string")
            : [];

          const forbiddenTexts = [...answeredRows.map((r) => r.question), ...shownThisSession];
          const forbiddenNormalized = new Set(forbiddenTexts.map(normalizeQuestionText));

          const MAX_ATTEMPTS = 3;
          let result: GeneratedQuestion | null = null;
          let lastError = "";

          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const previousQuestionText =
              forbiddenTexts.length > 0
                ? forbiddenTexts.map((q, index) => `${index + 1}. ${q}`).join("\n")
                : "No previous questions.";

            const retryNote =
              attempt > 1
                ? `\n\nYour previous attempt repeated an already-used question. This is attempt ${attempt} — generate something clearly different in numbers, wording, and context, not just a reworded copy.`
                : "";

            const prompt = `
You are AceLearn AI, a highly careful educational question generator.

Generate ONE high-quality multiple-choice question.

Subject: ${subject}
Exam / Level: ${level}
Topic: ${topic}
Difficulty: ${difficulty}
Student: ${studentId}

Previously asked questions (do not repeat or lightly reword any of these):
${previousQuestionText}${retryNote}

STRICT RULES:
1. Generate a genuinely NEW question.
2. Do NOT repeat any previous question.
3. Do NOT make a trivial rewrite of a previous question.
4. Exactly FOUR options.
5. Exactly ONE option must be correct.
6. correctAnswer MUST exactly match one option.
7. Verify the answer before returning.
8. Verify every mathematical calculation.
9. Verify every scientific fact.
10. Explanation must prove the answer.
11. Avoid ambiguous wording.
12. Match the requested difficulty.
13. Return ONLY valid JSON.

Return exactly:
{
  "question": "Question text",
  "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
  "correctAnswer": "Exact correct option",
  "explanation": "Clear step-by-step explanation",
  "subject": "${subject}",
  "level": "${level}",
  "topic": "${topic}",
  "difficulty": "${difficulty}"
}
`;

            const completion = await groq.chat.completions.create({
              model: "openai/gpt-oss-20b",
              // Slightly higher than the original 0.2 — low temperature was
              // the main reason the model kept generating the same
              // "canonical" example question for a given topic.
              temperature: 0.5,
              messages: [
                {
                  role: "system",
                  content:
                    "You are an extremely careful educational question generator. Accuracy is more important than creativity, but you must never repeat a previous question. Return only valid JSON.",
                },
                { role: "user", content: prompt },
              ],
              response_format: { type: "json_object" },
            });

            const content = completion.choices[0]?.message?.content;
            if (typeof content !== "string") {
              lastError = "AI returned an empty question.";
              continue;
            }

            const raw = safeJsonParse<Partial<GeneratedQuestion>>(content);
            if (!raw) {
              lastError = "AI returned invalid JSON.";
              continue;
            }

            const questionText = getString(raw.question);
            const options = getStringArray(raw.options);
            const correctAnswer = getString(raw.correctAnswer);
            const explanation = getString(raw.explanation);

            if (!questionText || options.length !== 4 || !correctAnswer || !explanation) {
              lastError = "AI generated an invalid question.";
              continue;
            }

            const uniqueOptions = new Set(options.map(normalizeAnswer));
            if (uniqueOptions.size !== 4) {
              lastError = "AI generated duplicate options.";
              continue;
            }

            const correctExists = options.some(
              (option) => normalizeAnswer(option) === normalizeAnswer(correctAnswer),
            );
            if (!correctExists) {
              lastError = "Correct answer does not match any option.";
              continue;
            }

            // The actual duplicate check that fixes the reported bug.
            if (forbiddenNormalized.has(normalizeQuestionText(questionText))) {
              lastError = "AI repeated a previous question.";
              continue; // try again with a stronger retry note
            }

            result = {
              question: questionText,
              options,
              correctAnswer,
              explanation,
              subject: getString(raw.subject) || subject,
              level: getString(raw.level) || level,
              topic: getString(raw.topic) || topic,
              difficulty: getString(raw.difficulty) || difficulty,
            };
            break;
          }

          if (!result) {
            return reply.code(502).send({
              success: false,
              error: lastError || "Failed to generate a unique question after several attempts.",
            });
          }

          return { success: true, question: result };
        } catch (error) {
          console.error("❌ Generate question error:", error);
          return reply
            .code(502)
            .send({ success: false, error: "Failed to generate question. Please try again." });
        }
      },
    );

    app.post("/api/agent/analyze", async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = (request.body || {}) as AnalyzeBody;
        const studentId = body.studentId?.trim() || "demo-student";

        if (!body.question?.trim() || !body.studentAnswer?.trim() || !body.correctAnswer?.trim()) {
          return reply.code(400).send({ success: false, error: "Missing required question data." });
        }

        const topic = body.topic?.trim() || "General";
        const difficulty = body.difficulty?.trim() || "easy";

        const previousStudent = db
          .prepare(
            `SELECT id, total_attempts, correct_answers, accuracy, current_streak, best_streak, skill_level, current_difficulty, last_recommendation FROM students WHERE id = ?`,
          )
          .get(studentId) as Student | undefined;

        const previousPerformance =
          body.previousPerformance?.trim() ||
          (previousStudent
            ? `
Previous student progress:
Total attempts: ${previousStudent.total_attempts}
Correct answers: ${previousStudent.correct_answers}
Accuracy: ${previousStudent.accuracy}%
Current streak: ${previousStudent.current_streak}
Best streak: ${previousStudent.best_streak}
Skill level: ${previousStudent.skill_level}
Current difficulty: ${previousStudent.current_difficulty}
Last recommendation: ${previousStudent.last_recommendation}
`
            : "No previous performance available.");

        const isCorrect =
          normalizeAnswer(body.studentAnswer) === normalizeAnswer(body.correctAnswer);

        const previousAttempts = previousStudent?.total_attempts || 0;
        const previousCorrect = previousStudent?.correct_answers || 0;
        const previousStreak = previousStudent?.current_streak || 0;
        const previousBestStreak = previousStudent?.best_streak || 0;

        const totalAttempts = previousAttempts + 1;
        const correctAnswers = previousCorrect + (isCorrect ? 1 : 0);
        const accuracy = calculateAccuracy(correctAnswers, totalAttempts);
        const currentStreak = isCorrect ? previousStreak + 1 : 0;
        const bestStreak = Math.max(previousBestStreak, currentStreak);

        const prompt = `
You are AceLearn AI, an adaptive educational tutor.

Analyze the student's answer.

Student: ${studentId}
Topic: ${topic}
Difficulty: ${difficulty}
Question: ${body.question}
Options: ${(body.options || []).join(" | ")}
Correct answer: ${body.correctAnswer}
Student answer: ${body.studentAnswer}
Previous performance: ${previousPerformance}
BACKEND CORRECTNESS: ${isCorrect ? "CORRECT" : "INCORRECT"}

STRICT RULES:
1. NEVER change the supplied correct answer.
2. NEVER contradict backend correctness.
3. Explain the answer clearly, step by step.
4. Name the exact concept/formula used and show how it is applied.
5. If incorrect, explain exactly why.
6. Show the correct solution with every calculation step.
7. Identify the likely mistake.
8. Recommend targeted practice.
9. Select a sensible next difficulty.
10. Do not invent facts.
11. Be encouraging but honest.
12. Return ONLY valid JSON.

Return:
{
  "correct": ${isCorrect},
  "skillLevel": "beginner",
  "feedback": "Student-friendly feedback",
  "correctAnswer": "${body.correctAnswer}",
  "explanation": "Step-by-step solution naming the formula/concept used",
  "mistake": "Likely mistake",
  "nextDifficulty": "medium",
  "recommendation": "What to practice next",
  "nextTopic": "Recommended topic",
  "agentDecision": "Why this decision was made",
  "action": "Concrete next action"
}

Allowed skill levels: beginner, developing, proficient, advanced
Allowed difficulties: easy, medium, hard
`;

        const completion = await groq.chat.completions.create({
          model: "openai/gpt-oss-20b",
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content:
                "You are a careful adaptive education agent. Never change supplied answers. Return only valid JSON.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        });

        const content = completion.choices[0]?.message?.content;
        if (typeof content !== "string") {
          return reply.code(502).send({ success: false, error: "AI returned an empty response." });
        }

        const result = safeJsonParse<AgentResult>(content);
        if (!result) {
          return reply.code(502).send({ success: false, error: "AI returned invalid JSON." });
        }

        const aiDifficulty = getString(result.nextDifficulty);
        const nextDifficulty = isDifficulty(aiDifficulty)
          ? aiDifficulty
          : getFallbackDifficulty(difficulty, isCorrect);

        const aiSkill = getString(result.skillLevel);
        const skillLevel = isSkillLevel(aiSkill) ? aiSkill : getFallbackSkillLevel(accuracy);

        saveStudentProgress({
          studentId,
          totalAttempts,
          correctAnswers,
          accuracy,
          currentStreak,
          bestStreak,
          skillLevel,
          currentDifficulty: nextDifficulty,
          lastRecommendation: getString(result.recommendation),
        });

        const now = new Date().toISOString();

        db.prepare(
          `INSERT INTO attempts (student_id, question, topic, difficulty, student_answer, correct_answer, correct, recommendation, next_topic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          studentId,
          body.question,
          topic,
          difficulty,
          body.studentAnswer,
          body.correctAnswer,
          isCorrect ? 1 : 0,
          getString(result.recommendation),
          getString(result.nextTopic),
          now,
        );

        const existingTopic = db
          .prepare(
            `SELECT topic, attempts, correct, accuracy FROM topic_progress WHERE student_id = ? AND topic = ?`,
          )
          .get(studentId, topic) as TopicProgress | undefined;

        if (existingTopic) {
          const newAttempts = existingTopic.attempts + 1;
          const newCorrect = existingTopic.correct + (isCorrect ? 1 : 0);
          const newAccuracy = calculateAccuracy(newCorrect, newAttempts);

          db.prepare(
            `UPDATE topic_progress SET attempts = ?, correct = ?, accuracy = ? WHERE student_id = ? AND topic = ?`,
          ).run(newAttempts, newCorrect, newAccuracy, studentId, topic);
        } else {
          db.prepare(
            `INSERT INTO topic_progress (student_id, topic, attempts, correct, accuracy) VALUES (?, ?, ?, ?, ?)`,
          ).run(studentId, topic, 1, isCorrect ? 1 : 0, isCorrect ? 100 : 0);
        }

        // ------------------------------------------
        // FIX: weak/strong topics computed HERE from the real
        // topic_progress table, not asked of the AI (the old prompt
        // never even requested this field from the model, so it was
        // always empty). This is what makes the dashboard's "focus
        // areas" actually work.
        // ------------------------------------------
        const allTopics = db
          .prepare(`SELECT topic, attempts, correct, accuracy FROM topic_progress WHERE student_id = ?`)
          .all(studentId) as TopicProgress[];

        const weakTopics = allTopics
          .filter((t) => t.attempts >= 2 && t.accuracy < 60)
          .map((t) => t.topic);

        const strongTopics = allTopics
          .filter((t) => t.attempts >= 2 && t.accuracy >= 80)
          .map((t) => t.topic);

        return {
          success: true,
          agent: {
            ...result,
            correct: isCorrect,
            correctAnswer: body.correctAnswer,
            nextDifficulty,
            skillLevel,
            progress: {
              totalAttempts,
              correctAnswers,
              accuracy,
              currentStreak,
              bestStreak,
              skillLevel,
              currentDifficulty: nextDifficulty,
              weakTopics,
              strongTopics,
            },
          },
          database: { saved: true, studentId },
        };
      } catch (error) {
        console.error("❌ Analyze error:", error);
        return reply
          .code(502)
          .send({ success: false, error: "AI Agent failed to process the answer. Please try again." });
      }
    });

    app.post("/api/chat", async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = (request.body || {}) as ChatBody;
        const studentId = body.studentId?.trim() || "demo-student";
        const message = body.message?.trim();

        if (!message) {
          return reply.code(400).send({ success: false, error: "Message is required." });
        }

        const student = db
          .prepare(
            `SELECT id, total_attempts, correct_answers, accuracy, current_streak, best_streak, skill_level, current_difficulty, last_recommendation FROM students WHERE id = ?`,
          )
          .get(studentId) as Student | undefined;

        const topics = db
          .prepare(
            `SELECT topic, attempts, correct, accuracy FROM topic_progress WHERE student_id = ? ORDER BY accuracy ASC LIMIT 30`,
          )
          .all(studentId) as TopicProgress[];

        const studentContext = student
          ? `
Student learning profile:
Student ID: ${student.id}
Total attempts: ${student.total_attempts}
Correct answers: ${student.correct_answers}
Accuracy: ${student.accuracy}%
Current streak: ${student.current_streak}
Best streak: ${student.best_streak}
Skill level: ${student.skill_level}
Current difficulty: ${student.current_difficulty}
Last recommendation: ${student.last_recommendation}

Topic performance:
${
  topics.length > 0
    ? topics.map((item) => `- ${item.topic}: ${item.accuracy}% accuracy (${item.correct}/${item.attempts})`).join("\n")
    : "No topic performance available."
}
`
          : `No saved student profile is available. Treat this as a new learner.`;

        const systemPrompt = `You are AceLearn AI, a highly reliable educational AI tutor.

You help students with: Mathematics, Physics, Chemistry, Biology, Computer Science, English,
JEE Main, JEE Advanced, NEET, SAT, School subjects, Problem solving, Concept explanations,
Exam preparation, Study planning.

IMPORTANT ACCURACY RULES:
1. Understand the student's actual question — including follow-up questions that refer back
   to something said earlier in this same conversation (e.g. "name all the chapters" after
   discussing a specific book means: name the chapters of THAT book).
2. Correct obvious spelling mistakes mentally when the intended meaning is clear.
3. Only ask for clarification if the conversation genuinely gives no way to infer what's meant
   — don't ask again for something already established earlier in this chat.
4. Never invent facts. For well-known, standard curricula (e.g. NCERT), answer from general
   knowledge of that curriculum. If asked about a specific, less common edition or a detail you
   genuinely don't know, say so plainly rather than guessing.
5. Verify mathematics carefully.
6. Verify physics and chemistry definitions and formulas.
7. If the student's statement is wrong, politely correct it.
8. Explain WHY something is correct.
9. Do not claim a connection problem unless the API actually failed.
10. Do not unnecessarily repeat previous answers.
11. Use simple language for simple questions.
12. Give step-by-step calculations for numerical problems, naming the formula used.
13. For JEE-level questions, give appropriate depth.
14. Never shame the student.
15. Accuracy is more important than sounding impressive.
16. If the user asks a definition, answer directly first.
17. If the user asks for an example, provide a relevant example.
18. If the user asks a comparison, compare clearly.
19. If information is missing AND cannot be inferred from earlier in this conversation, ask for it.
20. If this student's topic performance shows a weak area (below 60%) and the question connects to it, gently note the connection.

${studentContext}`;

        // Prior turns of THIS conversation, sent by the frontend. This is
        // what makes follow-ups like "name all the chapters" work — without
        // it, every message looked like a brand new conversation to the AI.
        const MAX_HISTORY_MESSAGES = 16;
        const history: ChatMessage[] = Array.isArray(body.history)
          ? body.history
              .filter(
                (m): m is ChatMessage =>
                  m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
              )
              .slice(-MAX_HISTORY_MESSAGES)
          : [];

        const completion = await groq.chat.completions.create({
          model: "openai/gpt-oss-20b",
          temperature: 0.3,
          messages: [
            { role: "system", content: systemPrompt },
            ...history.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: message },
          ],
        });

        const answer = completion.choices[0]?.message?.content;
        if (typeof answer !== "string" || !answer.trim()) {
          return reply
            .code(502)
            .send({ success: false, error: "AI returned an empty response. Please try again." });
        }

        return { success: true, studentId, answer: answer.trim() };
      } catch (error) {
        // Log the real error server-side, and surface a short version to
        // the client too — the old generic message hid what actually went
        // wrong (rate limit, invalid key, network issue, etc.).
        console.error("❌ Chat error:", error);
        const detail = error instanceof Error ? error.message : String(error);
        return reply.code(502).send({
          success: false,
          error: `AI is temporarily unavailable: ${detail}`,
        });
      }
    });

    app.get(
      "/api/students/:studentId/progress",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const params = request.params as { studentId: string };

          const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(params.studentId);

          if (!student) {
            return reply.code(404).send({ success: false, error: "Student progress not found." });
          }

          const attempts = db
            .prepare(`SELECT * FROM attempts WHERE student_id = ? ORDER BY id DESC`)
            .all(params.studentId);

          const topics = db
            .prepare(`SELECT * FROM topic_progress WHERE student_id = ? ORDER BY accuracy ASC`)
            .all(params.studentId);

          return { success: true, student, attempts, topics };
        } catch (error) {
          console.error("❌ Progress error:", error);
          return reply.code(500).send({ success: false, error: "Failed to load student progress." });
        }
      },
    );

    await app.listen({ port, host: "0.0.0.0" });
    console.log(`🚀 AceLearn AI backend running on port ${port}`);
  } catch (error) {
    console.error("❌ Server failed to start:", error);
    process.exit(1);
  }
}

void startServer();