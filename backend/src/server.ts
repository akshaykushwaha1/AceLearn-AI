import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import db, { saveStudentProgress } from "./database";

dotenv.config();

const app = Fastify({
  logger: true,
});

const port = Number(process.env.PORT || 3001);

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

type AnalyzeBody = {
  studentId?: string;
  question: string;
  options: string[];
  correctAnswer: string;
  studentAnswer: string;
  topic: string;
  difficulty: string;
  previousPerformance?: string;
};

async function startServer() {
  try {
    await app.register(cors, {
      origin: true,
    });

    // --------------------------------------------------
    // ROOT
    // --------------------------------------------------

    app.get("/", async () => {
      return {
        name: "AceLearn AI",
        message: "AI Study Agent backend is running",
        status: "online",
        health: "/health",
      };
    });

    // --------------------------------------------------
    // HEALTH
    // --------------------------------------------------

    app.get("/health", async () => {
      return {
        ok: true,
        service: "AceLearn AI Agent",
        status: "online",
        database: "connected",
      };
    });

    // --------------------------------------------------
    // ANALYZE STUDENT ANSWER
    // --------------------------------------------------

    app.post(
      "/api/agent/analyze",
      async (request, reply) => {
        try {
          const body =
            request.body as AnalyzeBody;

          const studentId =
            body.studentId || "demo-student";

          // ------------------------------------------
          // Validate request
          // ------------------------------------------

          if (
            !body.question ||
            !body.studentAnswer ||
            !body.correctAnswer
          ) {
            return reply.code(400).send({
              success: false,
              error:
                "Missing required question data.",
            });
          }

          // ------------------------------------------
          // Get previous student progress
          // ------------------------------------------

          const previousStudent =
            db
              .prepare(
                `
                SELECT *
                FROM students
                WHERE id = ?
                `,
              )
              .get(studentId) as
              | {
                  id: string;
                  total_attempts: number;
                  correct_answers: number;
                  accuracy: number;
                  current_streak: number;
                  best_streak: number;
                  skill_level: string;
                  current_difficulty: string;
                  last_recommendation: string;
                }
              | undefined;

          const previousPerformance =
            body.previousPerformance ||
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
          // AI prompt
          // ------------------------------------------

          const prompt = `
You are AceLearn AI, an adaptive education agent.

Your job is to analyze a student's answer and decide
what the student should do next.

Student ID:
${studentId}

Student topic:
${body.topic || "General"}

Current difficulty:
${body.difficulty || "easy"}

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

Analyze the student's performance.

Return ONLY valid JSON with this structure:

{
  "correct": true,
  "skillLevel": "beginner",
  "feedback": "Short encouraging explanation.",
  "nextDifficulty": "medium",
  "recommendation": "What the student should practice next.",
  "nextTopic": "Recommended next topic.",
  "agentDecision": "Why the agent made this decision.",
  "action": "A concrete next action for the student.",
  "progress": {
    "totalAttempts": 1,
    "correctAnswers": 1,
    "accuracy": 100,
    "currentStreak": 1,
    "bestStreak": 1,
    "skillLevel": "beginner",
    "currentDifficulty": "medium",
    "weakTopics": [],
    "strongTopics": []
  }
}

Rules:

- correct must be true or false.
- skillLevel must be beginner, developing, proficient, or advanced.
- nextDifficulty must be easy, medium, or hard.
- Keep feedback student-friendly.
- Never shame the student.
- Adapt difficulty based on performance.
- If the student is wrong, recommend targeted review.
- If the student is correct, consider increasing difficulty.
- Use previous performance when deciding the next step.
- Calculate progress using previous saved performance plus this attempt.
- totalAttempts must increase by 1.
- correctAnswers must increase only when the answer is correct.
- accuracy must be correctAnswers / totalAttempts * 100.
- currentStreak increases after a correct answer.
- currentStreak becomes 0 after an incorrect answer.
- bestStreak must never decrease.
- Identify weak topics from incorrect performance.
- Identify strong topics from consistently correct performance.
`;

          // ------------------------------------------
          // Groq AI
          // ------------------------------------------

          const completion =
            await groq.chat.completions.create({
              model: "openai/gpt-oss-20b",

              messages: [
                {
                  role: "system",
                  content:
                    "You are a careful adaptive education agent. Return only valid JSON.",
                },
                {
                  role: "user",
                  content: prompt,
                },
              ],

              temperature: 0.2,

              response_format: {
                type: "json_object",
              },
            });

          const content =
            completion.choices[0]?.message?.content;

          if (!content) {
            return reply.code(500).send({
              success: false,
              error:
                "AI returned an empty response.",
            });
          }

          // ------------------------------------------
          // Parse AI response
          // ------------------------------------------

          const result = JSON.parse(content);

          const progress =
            result.progress || {};

          // ------------------------------------------
          // Save student progress
          // ------------------------------------------

          saveStudentProgress({
            studentId,

            totalAttempts:
              Number(
                progress.totalAttempts ?? 0,
              ),

            correctAnswers:
              Number(
                progress.correctAnswers ?? 0,
              ),

            accuracy:
              Number(
                progress.accuracy ?? 0,
              ),

            currentStreak:
              Number(
                progress.currentStreak ?? 0,
              ),

            bestStreak:
              Number(
                progress.bestStreak ?? 0,
              ),

            skillLevel:
              progress.skillLevel ||
              result.skillLevel ||
              "beginner",

            currentDifficulty:
              progress.currentDifficulty ||
              result.nextDifficulty ||
              body.difficulty ||
              "easy",

            lastRecommendation:
              result.recommendation || "",
          });

          // ------------------------------------------
          // Save question attempt
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
            body.topic || "General",
            body.difficulty || "easy",
            body.studentAnswer,
            body.correctAnswer,
            result.correct ? 1 : 0,
            result.recommendation || "",
            result.nextTopic || "",
            now,
          );

          // ------------------------------------------
          // Save topic progress
          // ------------------------------------------

          const topic =
            body.topic || "General";

          const existingTopic =
            db
              .prepare(
                `
                SELECT *
                FROM topic_progress
                WHERE student_id = ?
                AND topic = ?
                `,
              )
              .get(
                studentId,
                topic,
              ) as
              | {
                  attempts: number;
                  correct: number;
                }
              | undefined;

          if (existingTopic) {
            const newAttempts =
              existingTopic.attempts + 1;

            const newCorrect =
              existingTopic.correct +
              (result.correct ? 1 : 0);

            const newAccuracy =
              (newCorrect / newAttempts) * 100;

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
              result.correct ? 1 : 0,
              result.correct ? 100 : 0,
            );
          }

          // ------------------------------------------
          // Final response
          // ------------------------------------------

          return {
            success: true,

            agent: result,

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
              "AI Agent failed to process the answer.",
          });
        }
      },
    );

    // --------------------------------------------------
    // GET STUDENT PROGRESS
    // --------------------------------------------------

    app.get(
      "/api/students/:studentId/progress",
      async (request, reply) => {
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

    // ------------------------------------------
    // Start server
    // ------------------------------------------

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

startServer();