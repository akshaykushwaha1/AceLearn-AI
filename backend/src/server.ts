import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";

dotenv.config();

const app = Fastify({
  logger: true,
});

const port = Number(process.env.PORT || 3001);

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function startServer() {
  try {
    await app.register(cors, {
      origin: true,
    });

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
      };
    });

    app.post("/api/agent/analyze", async (request, reply) => {
      try {
        const body = request.body as {
          question: string;
          options: string[];
          correctAnswer: string;
          studentAnswer: string;
          topic: string;
          difficulty: string;
          previousPerformance?: string;
        };

        if (
          !body.question ||
          !body.studentAnswer ||
          !body.correctAnswer
        ) {
          return reply.code(400).send({
            error: "Missing required question data.",
          });
        }

        const prompt = `
You are AceLearn AI, an adaptive education agent.

Your job is to analyze a student's answer and decide
what the student should do next.

Student topic:
${body.topic}

Current difficulty:
${body.difficulty}

Question:
${body.question}

Options:
${body.options.join(" | ")}

Correct answer:
${body.correctAnswer}

Student answer:
${body.studentAnswer}

Previous performance:
${body.previousPerformance || "No previous performance available."}

Analyze the student's performance.

Return ONLY valid JSON with this exact structure:

{
  "correct": true,
  "skillLevel": "beginner",
  "feedback": "Short encouraging explanation.",
  "nextDifficulty": "medium",
  "recommendation": "What the student should practice next.",
  "agentDecision": "Why the agent made this decision."
}

Rules:

- correct must be true or false.
- skillLevel must be beginner, developing, proficient, or advanced.
- nextDifficulty must be easy, medium, or hard.
- Keep feedback student-friendly.
- Never shame the student.
- The agent must adapt difficulty based on performance.
- If the student is wrong, recommend targeted review.
- If the student is correct, consider increasing difficulty.
`;

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
            error: "AI returned an empty response.",
          });
        }

        const result = JSON.parse(content);

        return {
          success: true,
          agent: result,
        };
      } catch (error) {
        console.error("Agent error:", error);

        return reply.code(500).send({
          success: false,
          error: "AI Agent failed to process the answer.",
        });
      }
    });

    await app.listen({
      port,
      host: "0.0.0.0",
    });

    console.log(
      `🚀 AceLearn AI backend running on port ${port}`
    );
  } catch (error) {
    console.error("❌ Server failed to start:", error);

    process.exit(1);
  }
}

startServer();