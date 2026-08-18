```typescript
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

// ==================================================
// APP CONFIG
// ==================================================

const app: FastifyInstance = Fastify({
  logger: true,
});

const port = Number(process.env.PORT || 3001);

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.error(
    "❌ GROQ_API_KEY is missing in backend/.env",
  );
  process.exit(1);
}

const groq = new Groq({
  apiKey,
});

// ==================================================
// TYPES
// ==================================================

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

type ChatBody = {
  studentId?: string;
  message: string;
};

type GenerateQuestionBody = {
  studentId?: string;
  subject?: string;
  level?: string;
  topic?: string;
  difficulty?: string;
};

type GeneratedQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  subject?: string;
  level?: string;
  topic?: string;
  difficulty?: string;
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

type GenerateQuestionResponse = {
  question?: string;
  options?: unknown;
  correctAnswer?: string;
  explanation?: string;
  subject?: string;
  level?: string;
  topic?: string;
  difficulty?: string;
};

type ChatMessageResponse = {
  content?: string | null;
};

// ==================================================
// HELPERS
// ==================================================

function safeJsonParse<T>(
  value: string,
): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function calculateAccuracy(
  correctAnswers: number,
  totalAttempts: number,
): number {
  if (totalAttempts <= 0) {
    return 0;
  }

  return Number(
    ((correctAnswers / totalAttempts) * 100).toFixed(2),
  );
}

function normalizeAnswer(
  value: string,
): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isDifficulty(
  value: string,
): value is "easy" | "medium" | "hard" {
  return (
    value === "easy" ||
    value === "medium" ||
    value === "hard"
  );
}

function isSkillLevel(
  value: string,
): value is
  | "beginner"
  | "developing"
  | "proficient"
  | "advanced" {
  return (
    value === "beginner" ||
    value === "developing" ||
    value === "proficient" ||
    value === "advanced"
  );
}

function getFallbackDifficulty(
  currentDifficulty: string,
  isCorrect: boolean,
): "easy" | "medium" | "hard" {
  const current = isDifficulty(currentDifficulty)
    ? currentDifficulty
    : "easy";

  if (!isCorrect) {
    if (current === "hard") return "medium";
    return "easy";
  }

  if (current === "easy") return "medium";
  if (current === "medium") return "hard";

  return "hard";
}

function getFallbackSkillLevel(
  accuracy: number,
): "beginner" | "developing" | "proficient" | "advanced" {
  if (accuracy >= 85) {
    return "advanced";
  }

  if (accuracy >= 70) {
    return "proficient";
  }

  if (accuracy >= 40) {
    return "developing";
  }

  return "beginner";
}

function getString(
  value: unknown,
  fallback = "",
): string {
  return typeof value === "string"
    ? value.trim()
    : fallback;
}

function getStringArray(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string",
  );
}

// ==================================================
// SERVER
// ==================================================

async function startServer(): Promise<void> {
  try {
    await app.register(cors, {
      origin: true,
    });

    // ==================================================
    // ROOT
    // ==================================================

    app.get("/", async () => {
      return {
        name: "AceLearn AI",
        message: "AI Study Agent backend is running",
        status: "online",
        health: "/health",
      };
    });

    // ==================================================
    // HEALTH
    // ==================================================

    app.get("/health", async () => {
      return {
        ok: true,
        service: "AceLearn AI Agent",
        status: "online",
        database: "connected",
      };
    });

    // ==================================================
    // GENERATE QUESTION
    // ==================================================

    app.post(
      "/api/agent/generate-question",
      async (
        request: FastifyRequest,
        reply: FastifyReply,
      ) => {
        try {
          const body =
            (request.body || {}) as GenerateQuestionBody;

          const studentId =
            body.studentId?.trim() ||
            "demo-student";

          const subject =
            body.subject?.trim() ||
            "Mathematics";

          const level =
            body.level?.trim() ||
            "JEE Main";

          const topic =
            body.topic?.trim() ||
            "General";

          const difficulty =
            body.difficulty?.trim() ||
            "medium";

          // ------------------------------------------
          // Previous questions
          // ------------------------------------------

          const previousQuestions = db
            .prepare(
              `
              SELECT question
              FROM attempts
              WHERE student_id = ?
              ORDER BY id DESC
              LIMIT 30
              `,
            )
            .all(studentId) as {
            question: string;
          }[];

          const previousQuestionText =
            previousQuestions.length > 0
              ? previousQuestions
                  .map(
                    (item, index) =>
                      `${index + 1}. ${item.question}`,
                  )
                  .join("\n")
              : "No previous questions.";

          // ------------------------------------------
          // Generate prompt
          // ------------------------------------------

          const prompt = `
You are AceLearn AI, an expert educational question generator.

Generate ONE high-quality question.

Subject:
${subject}

Exam / Level:
${level}

Topic:
${topic}

Difficulty:
${difficulty}

Student ID:
${studentId}

Previously asked questions:
${previousQuestionText}

IMPORTANT:

1. Generate a genuinely NEW question.
2. Do NOT repeat or slightly rewrite a previous question.
3. Exactly ONE option must be correct.
4. Return exactly FOUR options.
5. The correct answer MUST exactly match one option.
6. Verify the answer before returning it.
7. Verify all mathematical calculations.
8. Verify scientific facts.
9. The explanation must prove the correct answer.
10. Match the requested difficulty.
11. Do not invent formulas or facts.
12. Do not use ambiguous wording.
13. Return ONLY valid JSON.

Return exactly:

{
  "question": "Question text",
  "options": [
    "Option 1",
    "Option 2",
    "Option 3",
    "Option 4"
  ],
  "correctAnswer": "Exact correct option",
  "explanation": "Clear step-by-step explanation",
  "subject": "${subject}",
  "level": "${level}",
  "topic": "${topic}",
  "difficulty": "${difficulty}"
}
`;

          const completion =
            await groq.chat.completions.create({
              model: "openai/gpt-oss-20b",
              temperature: 0.2,

              messages: [
                {
                  role: "system",
                  content:
                    "You are a highly careful educational question generator. Verify every answer before returning JSON.",
                },
                {
                  role: "user",
                  content: prompt,
                },
              ],

              response_format: {
                type: "json_object",
              },
            });

          const content =
            completion.choices[0]?.message
              ?.content;

          if (typeof content !== "string") {
            return reply.code(500).send({
              success: false,
              error:
                "AI returned an empty question.",
            });
          }

          const rawQuestion =
            safeJsonParse<GenerateQuestionResponse>(
              content,
            );

          if (!rawQuestion) {
            return reply.code(500).send({
              success: false,
              error:
                "AI returned invalid JSON.",
            });
          }

          const questionText =
            getString(rawQuestion.question);

          const options =
            getStringArray(rawQuestion.options);

          const correctAnswer =
            getString(
              rawQuestion.correctAnswer,
            );

          const explanation =
            getString(
              rawQuestion.explanation,
            );

          if (
            !questionText ||
            options.length !== 4 ||
            !correctAnswer ||
            !explanation
          ) {
            return reply.code(500).send({
              success: false,
              error:
                "AI generated an invalid question structure.",
            });
          }

          const uniqueOptions = new Set(
            options.map(normalizeAnswer),
          );

          if (uniqueOptions.size !== 4) {
            return reply.code(500).send({
              success: false,
              error:
                "AI generated duplicate options.",
            });
          }

          const correctExists =
            options.some(
              (option) =>
                normalizeAnswer(option) ===
                normalizeAnswer(correctAnswer),
            );

          if (!correctExists) {
            return reply.code(500).send({
              success: false,
              error:
                "AI generated a correct answer that does not match the options.",
            });
          }

          const result: GeneratedQuestion = {
            question: questionText,
            options,
            correctAnswer,
            explanation,
            subject:
              getString(
                rawQuestion.subject,
              ) || subject,
            level:
              getString(
                rawQuestion.level,
              ) || level,
            topic:
              getString(
                rawQuestion.topic,
              ) || topic,
            difficulty:
              getString(
                rawQuestion.difficulty,
              ) || difficulty,
          };

          return {
            success: true,
            question: result,
          };
        } catch (error) {
          console.error(
            "❌ Generate question error:",
            error,
          );

          return reply.code(500).send({
            success: false,
            error:
              "Failed to generate question. Please try again.",
          });
        }
      },
    );

    // ==================================================
    // ANALYZE STUDENT ANSWER
    // ==================================================

    app.post(
      "/api/agent/analyze",
      async (
        request: FastifyRequest,
        reply: FastifyReply,
      ) => {
        try {
          const body =
            (request.body || {}) as AnalyzeBody;

          const studentId =
            body.studentId?.trim() ||
            "demo-student";

          if (
            !body.question?.trim() ||
            !body.studentAnswer?.trim() ||
            !body.correctAnswer?.trim()
          ) {
            return reply.code(400).send({
              success: false,
              error:
                "Missing required question data.",
            });
          }

          const topic =
            body.topic?.trim() ||
            "General";

          const difficulty =
            body.difficulty?.trim() ||
            "easy";

          // ------------------------------------------
          // Previous student progress
          // ------------------------------------------

          const previousStudent =
            db
              .prepare(
                `
                SELECT
                  id,
                  total_attempts,
                  correct_answers,
                  accuracy,
                  current_streak,
                  best_streak,
                  skill_level,
                  current_difficulty,
                  last_recommendation
                FROM students
                WHERE id = ?
                `,
              )
              .get(studentId) as
              | Student
              | undefined;

          const previousPerformance =
            body.previousPerformance?.trim() ||
            (previousStudent
              ? `
Previous saved progress:

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

          // ------------------------------------------
          // Determine correctness ourselves
          // ------------------------------------------

          const isCorrect =
            normalizeAnswer(
              body.studentAnswer,
            ) ===
            normalizeAnswer(
              body.correctAnswer,
            );

          // ------------------------------------------
          // Previous values
          // ------------------------------------------

          const previousAttempts =
            previousStudent?.total_attempts ||
            0;

          const previousCorrect =
            previousStudent?.correct_answers ||
            0;

          const previousStreak =
            previousStudent?.current_streak ||
            0;

          const previousBestStreak =
            previousStudent?.best_streak ||
            0;

          const totalAttempts =
            previousAttempts + 1;

          const correctAnswers =
            previousCorrect +
            (isCorrect ? 1 : 0);

          const accuracy =
            calculateAccuracy(
              correctAnswers,
              totalAttempts,
            );

          const currentStreak =
            isCorrect
              ? previousStreak + 1
              : 0;

          const bestStreak =
            Math.max(
              previousBestStreak,
              currentStreak,
            );

          // ------------------------------------------
          // AI analysis
          // ------------------------------------------

          const prompt = `
You are AceLearn AI, an adaptive educational tutor.

Analyze this student's answer.

Student:
${studentId}

Topic:
${topic}

Difficulty:
${difficulty}

Question:
${body.question}

Options:
${(body.options || []).join(" | ")}

Correct answer:
${body.correctAnswer}

Student answer:
${body.studentAnswer}

Previous performance:
${previousPerformance}

The backend has already determined correctness as:
${isCorrect ? "CORRECT" : "INCORRECT"}

IMPORTANT RULES:

1. Do NOT change the supplied correct answer.
2. Do NOT contradict the backend correctness result.
3. Explain the answer clearly.
4. If incorrect, explain the exact mistake.
5. Give the correct solution.
6. Recommend targeted practice.
7. Choose a sensible next difficulty.
8. Do not invent facts.
9. Be encouraging but honest.
10. Return ONLY valid JSON.

Return:

{
  "correct": ${isCorrect},
  "skillLevel": "beginner",
  "feedback": "Clear student-friendly feedback.",
  "correctAnswer": "${body.correctAnswer}",
  "explanation": "Step-by-step correct solution.",
  "mistake": "Likely mistake or empty string.",
  "nextDifficulty": "medium",
  "recommendation": "What to practice next.",
  "nextTopic": "Recommended topic.",
  "agentDecision": "Why this decision was made.",
  "action": "Concrete next action."
}

Allowed skill levels:
beginner, developing, proficient, advanced

Allowed difficulties:
easy, medium, hard
`;

          const completion =
            await groq.chat.completions.create({
              model: "openai/gpt-oss-20b",
              temperature: 0.1,

              messages: [
                {
                  role: "system",
                  content:
                    "You are a careful adaptive education agent. Never change supplied answers. Return only valid JSON.",
                },
                {
                  role: "user",
                  content: prompt,
                },
              ],

              response_format: {
                type: "json_object",
              },
            });

          const content =
            completion.choices[0]?.message
              ?.content;

          if (typeof content !== "string") {
            return reply.code(500).send({
              success: false,
              error:
                "AI returned an empty response.",
            });
          }

          const result =
            safeJsonParse<AgentResult>(
              content,
            );

          if (!result) {
            return reply.code(500).send({
              success: false,
              error:
                "AI returned invalid JSON.",
            });
          }

          // ------------------------------------------
          // Difficulty
          // ------------------------------------------

          const requestedNextDifficulty =
            getString(
              result.nextDifficulty,
            );

          const nextDifficulty =
            isDifficulty(
              requestedNextDifficulty,
            )
              ? requestedNextDifficulty
              : getFallbackDifficulty(
                  difficulty,
                  isCorrect,
                );

          // ------------------------------------------
          // Skill level
          // ------------------------------------------

          const requestedSkill =
            getString(
              result.skillLevel,
            );

          const skillLevel =
            isSkillLevel(requestedSkill)
              ? requestedSkill
              : getFallbackSkillLevel(
                  accuracy,
                );

          // ------------------------------------------
          // Save student progress
          // ------------------------------------------

          saveStudentProgress({
            studentId,
            totalAttempts,
            correctAnswers,
            accuracy,
            currentStreak,
            bestStreak,
            skillLevel,
            currentDifficulty:
              nextDifficulty,
            lastRecommendation:
              getString(
                result.recommendation,
              ),
          });

          // ------------------------------------------
          // Save attempt
          // ------------------------------------------

          const now =
            new Date().toISOString();

          db.prepare(
            `
            INSERT INTO attempts (
              student_id,
              question,
              topic,
              difficulty,
              student_answer,
              correct_answer,
              correct,
              recommendation,
              next_topic,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          ).run(
            studentId,
            body.question,
            topic,
            difficulty,
            body.studentAnswer,
            body.correctAnswer,
            isCorrect ? 1 : 0,
            getString(
              result.recommendation,
            ),
            getString(
              result.nextTopic,
            ),
            now,
          );

          // ------------------------------------------
          // Topic progress
          // ------------------------------------------

          const existingTopic =
            db
              .prepare(
                `
                SELECT
                  topic,
                  attempts,
                  correct,
                  accuracy
                FROM topic_progress
                WHERE student_id = ?
                AND topic = ?
                `,
              )
              .get(
                studentId,
                topic,
              ) as
              | TopicProgress
              | undefined;

          if (existingTopic) {
            const newAttempts =
              existingTopic.attempts + 1;

            const newCorrect =
              existingTopic.correct +
              (isCorrect ? 1 : 0);

            const newAccuracy =
              calculateAccuracy(
                newCorrect,
                newAttempts,
              );

            db.prepare(
              `
              UPDATE topic_progress
              SET
                attempts = ?,
                correct = ?,
                accuracy = ?
              WHERE student_id = ?
              AND topic = ?
              `,
            ).run(
              newAttempts,
              newCorrect,
              newAccuracy,
              studentId,
              topic,
            );
          } else {
            db.prepare(
              `
              INSERT INTO topic_progress (
                student_id,
                topic,
                attempts,
                correct,
                accuracy
              )
              VALUES (?, ?, ?, ?, ?)
              `,
            ).run(
              studentId,
              topic,
              1,
              isCorrect ? 1 : 0,
              isCorrect ? 100 : 0,
            );
          }

          // ------------------------------------------
          // Final response
          // ------------------------------------------

          return {
            success: true,

            agent: {
              ...result,

              correct: isCorrect,

              correctAnswer:
                body.correctAnswer,

              nextDifficulty,

              skillLevel,

              progress: {
                totalAttempts,
                correctAnswers,
                accuracy,
                currentStreak,
                bestStreak,
                skillLevel,
                currentDifficulty:
                  nextDifficulty,
                weakTopics:
                  result.progress
                    ?.weakTopics || [],
                strongTopics:
                  result.progress
                    ?.strongTopics || [],
              },
            },

            database: {
              saved: true,
              studentId,
            },
          };
        } catch (error) {
          console.error(
            "❌ Agent error:",
            error,
          );

          return reply.code(500).send({
            success: false,
            error:
              "AI Agent failed to process the answer. Please try again.",
          });
        }
      },
    );

    // ==================================================
    // UNIVERSAL AI CHAT
    // ==================================================

    app.post(
      "/api/chat",
      async (
        request: FastifyRequest,
        reply: FastifyReply,
      ) => {
        try {
          const body =
            (request.body || {}) as ChatBody;

          const studentId =
            body.studentId?.trim() ||
            "demo-student";

          const message =
            body.message?.trim();

          if (!message) {
            return reply.code(400).send({
              success: false,
              error:
                "Message is required.",
            });
          }

          // ------------------------------------------
          // Student profile
          // ------------------------------------------

          const student =
            db
              .prepare(
                `
                SELECT
                  id,
                  total_attempts,
                  correct_answers,
                  accuracy,
                  current_streak,
                  best_streak,
                  skill_level,
                  current_difficulty,
                  last_recommendation
                FROM students
                WHERE id = ?
                `,
              )
              .get(studentId) as
              | Student
              | undefined;

          // ------------------------------------------
          // Topic performance
          // ------------------------------------------

          const topics =
            db
              .prepare(
                `
                SELECT
                  topic,
                  attempts,
                  correct,
                  accuracy
                FROM topic_progress
                WHERE student_id = ?
                ORDER BY accuracy ASC
                LIMIT 30
                `,
              )
              .all(studentId) as TopicProgress[];

          const studentContext =
            student
              ? `
Student learning profile:

Student ID:
${student.id}

Total attempts:
${student.total_attempts}

Correct answers:
${student.correct_answers}

Accuracy:
${student.accuracy}%

Current streak:
${student.current_streak}

Best streak:
${student.best_streak}

Skill level:
${student.skill_level}

Current difficulty:
${student.current_difficulty}

Last recommendation:
${student.last_recommendation}

Topic performance:
${
  topics.length > 0
    ? topics
        .map(
          (item) =>
            `- ${item.topic}: ${item.accuracy}% accuracy (${item.correct}/${item.attempts})`,
        )
        .join("\n")
    : "No topic performance available."
}
`
              : `
No saved student profile is available.
Treat this as a new learner.
`;

          // ------------------------------------------
          // Educational prompt
          // ------------------------------------------

          const prompt = `
You are AceLearn AI, a highly reliable educational AI tutor.

Your goal is to help students learn correctly, not merely to produce text.

You can help with:

- Mathematics
- Physics
- Chemistry
- Biology
- Computer Science
- English
- JEE Main
- JEE Advanced
- NEET
- SAT
- School subjects
- Problem solving
- Concept explanations
- Exam preparation
- Study planning

IMPORTANT ACCURACY RULES:

1. Understand the student's actual question.
2. Correct obvious spelling mistakes and typos mentally when the intended meaning is clear.
3. Example: "vesper therom" may mean "VSEPR theory". If the intended meaning is uncertain, ask for clarification instead of guessing.
4. Do NOT invent information.
5. For mathematics, carefully calculate the answer before responding.
6. For physics and chemistry, verify definitions, formulas and scientific facts.
7. If the student's premise is incorrect, politely correct it.
8. If the question is ambiguous, clearly state the ambiguity.
9. If you genuinely cannot determine what the student means, ask one concise clarification question.
10. Never claim that the backend, database, browser, file or internet did something unless it actually did.
11. Do not say there is a connection problem unless an actual AI/API error occurred.
12. Do not unnecessarily repeat the same question or answer.
13. Use the student's level when explaining.
14. Beginner questions should receive simple explanations.
15. JEE questions should receive appropriate exam-level explanations.
16. When solving a numerical problem, show the important calculation steps.
17. When correcting a student, explain WHY the answer is wrong.
18. Give a useful answer directly instead of unnecessary filler.
19. Use headings, bullets, formulas and examples when they genuinely improve understanding.
20. Never shame the student.
21. If the student asks a simple definition, do not turn it into a huge lecture unless more detail is useful.
22. If a student asks for a comparison, clearly compare the concepts.
23. If the student asks for a formula, give the formula and explain the symbols.
24. If a question requires information that is missing, ask for the missing information.
25. Do not fabricate sources, citations or references.

ANSWER STYLE:

- Simple and clear by default.
- Accurate before impressive.
- Concise for simple questions.
- Detailed for difficult questions.
- Step-by-step for problem solving.
- Use examples when helpful.
- Respect the student's requested language.

${studentContext}

Student's message:

${message}

Answer the student directly.
`;

          // ------------------------------------------
          // Groq
          // ------------------------------------------

          const completion =
            await groq.chat.completions.create({
              model: "openai/gpt-oss-20b",
              temperature: 0.2,

              messages: [
                {
                  role: "system",
                  content:
                    "You are AceLearn AI, a careful, accurate and student-friendly educational tutor. Accuracy is more important than sounding confident.",
                },
                {
                  role: "user",
                  content: prompt,
                },
              ],
            });

          const messageResponse =
            completion.choices[0]
              ?.message as
              | ChatMessageResponse
              | undefined;

          const answer =
            typeof messageResponse?.content ===
            "string"
              ? messageResponse.content.trim()
              : "";

          if (!answer) {
            return reply.code(502).send({
              success: false,
              error:
                "AI returned an empty response. Please try again.",
            });
          }

          return {
            success: true,
            studentId,
            answer,
          };
        } catch (error) {
          console.error(
            "❌ Chat error:",
            error,
          );

          return reply.code(502).send({
            success: false,
            error:
              "AI is temporarily unavailable. Please try again.",
          });
        }
      },
    );

    // ==================================================
    // GET STUDENT PROGRESS
    // ==================================================

    app.get(
      "/api/students/:studentId/progress",
      async (
        request: FastifyRequest,
        reply: FastifyReply,
      ) => {
        try {
          const params =
            request.params as {
              studentId: string;
            };

          const student =
            db
              .prepare(
                `
                SELECT *
                FROM students
                WHERE id = ?
                `,
              )
              .get(params.studentId);

          if (!student) {
            return reply.code(404).send({
              success: false,
              error:
                "Student progress not found.",
            });
          }

          const attempts =
            db
              .prepare(
                `
                SELECT *
                FROM attempts
                WHERE student_id = ?
                ORDER BY id DESC
                `,
              )
              .all(params.studentId);

          const topics =
            db
              .prepare(
                `
                SELECT *
                FROM topic_progress
                WHERE student_id = ?
                ORDER BY accuracy ASC
                `,
              )
              .all(params.studentId);

          return {
            success: true,
            student,
            attempts,
            topics,
          };
        } catch (error) {
          console.error(
            "❌ Progress error:",
            error,
          );

          return reply.code(500).send({
            success: false,
            error:
              "Failed to load student progress.",
          });
        }
      },
    );

    // ==================================================
    // START SERVER
    // ==================================================

    await app.listen({
      port,
      host: "0.0.0.0",
    });

    console.log(
      `🚀 AceLearn AI backend running on port ${port}`,
    );
  } catch (error) {
    console.error(
      "❌ Server failed to start:",
      error,
    );

    process.exit(1);
  }
}

void startServer();

