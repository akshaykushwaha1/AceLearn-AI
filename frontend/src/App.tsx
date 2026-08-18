import { useEffect, useMemo, useState } from "react";

type Screen =
  | "home"
  | "setup"
  | "assessment"
  | "analysis"
  | "dashboard"
  | "session"
  | "chat"
  | "results";

type Difficulty = "easy" | "medium" | "hard";

type Question = {
  subject: string;
  level: string;
  topic: string;
  difficulty: Difficulty;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

type AgentResponse = {
  correct: boolean;
  skillLevel: string;
  feedback: string;
  correctAnswer?: string;
  explanation?: string;
  mistake?: string;
  nextDifficulty: Difficulty;
  recommendation: string;
  nextTopic?: string;
  agentDecision: string;
  action?: string;
  progress?: {
    totalAttempts: number;
    correctAnswers: number;
    accuracy: number;
    currentStreak: number;
    bestStreak: number;
    skillLevel: string;
    currentDifficulty: string;
    weakTopics: string[];
    strongTopics: string[];
  };
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const API_BASE = "/api";

const STUDENT_ID_KEY = "acelearn_student_id";

function getStudentId() {
  const existing = localStorage.getItem(STUDENT_ID_KEY);

  if (existing) {
    return existing;
  }

  const id = `student-${crypto.randomUUID()}`;
  localStorage.setItem(STUDENT_ID_KEY, id);

  return id;
}

function App() {
  const [screen, setScreen] = useState<Screen>("home");

  const [name, setName] = useState("");

  const [subject, setSubject] = useState("Mathematics");
  const [level, setLevel] = useState("JEE Main");
  const [topic, setTopic] = useState("Quadratic Equations");
  const [difficulty, setDifficulty] =
    useState<Difficulty>("medium");

  const [studyTime, setStudyTime] = useState("1 hour");

  const [currentQuestion, setCurrentQuestion] =
    useState<Question | null>(null);

  const [selectedAnswer, setSelectedAnswer] =
    useState("");

  const [agentResponse, setAgentResponse] =
    useState<AgentResponse | null>(null);

  const [loadingQuestion, setLoadingQuestion] =
    useState(false);

  const [agentLoading, setAgentLoading] =
    useState(false);

  const [error, setError] = useState("");

  const [questionNumber, setQuestionNumber] =
    useState(1);

  const [sessionScore, setSessionScore] =
    useState(0);

  const [sessionTotal, setSessionTotal] =
    useState(0);

  const [usedQuestions, setUsedQuestions] =
    useState<string[]>([]);

  const [sessionHistory, setSessionHistory] =
    useState<string[]>([]);

  const [progress, setProgress] = useState({
    totalAttempts: 0,
    correctAnswers: 0,
    accuracy: 0,
    currentStreak: 0,
    bestStreak: 0,
    skillLevel: "beginner",
    currentDifficulty: "medium",
    weakTopics: [] as string[],
    strongTopics: [] as string[],
  });

  const [chatMessages, setChatMessages] =
    useState<ChatMessage[]>([]);

  const [chatInput, setChatInput] =
    useState("");

  const [chatLoading, setChatLoading] =
    useState(false);

  const studentId = useMemo(
    () => getStudentId(),
    []
  );

  // =========================================================
  // LOAD SAVED STUDENT PROGRESS
  // =========================================================

  useEffect(() => {
    async function loadProgress() {
      try {
        const response = await fetch(
          `${API_BASE}/students/${studentId}/progress`
        );

        if (!response.ok) {
          return;
        }

        const data = await response.json();

        if (!data.success || !data.student) {
          return;
        }

        const student = data.student;

        setProgress({
          totalAttempts:
            Number(student.total_attempts) || 0,
          correctAnswers:
            Number(student.correct_answers) || 0,
          accuracy:
            Number(student.accuracy) || 0,
          currentStreak:
            Number(student.current_streak) || 0,
          bestStreak:
            Number(student.best_streak) || 0,
          skillLevel:
            student.skill_level || "beginner",
          currentDifficulty:
            student.current_difficulty || "medium",
          weakTopics: [],
          strongTopics: [],
        });
      } catch {
        // Progress is optional on first launch.
      }
    }

    void loadProgress();
  }, [studentId]);

  // =========================================================
  // GENERATE QUESTION FROM BACKEND
  // =========================================================

  async function generateQuestion(
    requestedDifficulty: Difficulty = difficulty
  ) {
    setLoadingQuestion(true);
    setError("");
    setAgentResponse(null);
    setSelectedAnswer("");

    try {
      const response = await fetch(
        `${API_BASE}/agent/generate-question`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            studentId,
            subject,
            level,
            topic,
            difficulty: requestedDifficulty,
            previousQuestions: usedQuestions,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Question API returned ${response.status}`
        );
      }

      const data = await response.json();

      if (!data.success || !data.question) {
        throw new Error(
          "Invalid question received from backend."
        );
      }

      const generated = data.question;

      const question: Question = {
        subject:
          generated.subject || subject,

        level:
          generated.level || level,

        topic:
          generated.topic || topic,

        difficulty:
          generated.difficulty ||
          requestedDifficulty,

        question:
          generated.question,

        options:
          Array.isArray(generated.options)
            ? generated.options
            : [],

        correctAnswer:
          generated.correctAnswer,

        explanation:
          generated.explanation ||
          "",
      };

      if (
        !question.question ||
        question.options.length < 2 ||
        !question.correctAnswer
      ) {
        throw new Error(
          "Backend returned an incomplete question."
        );
      }

      setCurrentQuestion(question);

      setUsedQuestions((previous) => [
        ...previous,
        question.question,
      ]);
    } catch (err) {
      console.error(
        "Question generation error:",
        err
      );

      setError(
        "AI question generate nahi kar pa raha. Backend aur Groq connection check karo."
      );
    } finally {
      setLoadingQuestion(false);
    }
  }

  // =========================================================
  // START PRACTICE
  // =========================================================

  async function startSession() {
    setSessionScore(0);
    setSessionTotal(0);
    setQuestionNumber(1);
    setUsedQuestions([]);
    setSessionHistory([]);
    setCurrentQuestion(null);
    setAgentResponse(null);
    setSelectedAnswer("");
    setError("");

    setScreen("session");

    await generateQuestion(
      progress.currentDifficulty === "easy" ||
        progress.currentDifficulty === "medium" ||
        progress.currentDifficulty === "hard"
        ? progress.currentDifficulty
        : difficulty
    );
  }

  // =========================================================
  // ANALYZE ANSWER
  // =========================================================

  async function submitAnswer(answer: string) {
    if (
      !currentQuestion ||
      agentLoading ||
      loadingQuestion
    ) {
      return;
    }

    setSelectedAnswer(answer);
    setAgentLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE}/agent/analyze`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            studentId,

            question:
              currentQuestion.question,

            options:
              currentQuestion.options,

            correctAnswer:
              currentQuestion.correctAnswer,

            studentAnswer: answer,

            topic:
              currentQuestion.topic,

            difficulty:
              currentQuestion.difficulty,

            previousPerformance:
              sessionHistory.length > 0
                ? sessionHistory.join("\n")
                : "No previous performance.",
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Analyze API returned ${response.status}`
        );
      }

      const data = await response.json();

      if (!data.success || !data.agent) {
        throw new Error(
          "Invalid analysis response."
        );
      }

      const result =
        data.agent as AgentResponse;

      setAgentResponse(result);

      if (result.correct) {
        setSessionScore(
          (previous) => previous + 1
        );
      }

      setSessionTotal(
        (previous) => previous + 1
      );

      if (result.progress) {
        setProgress({
          totalAttempts:
            result.progress.totalAttempts,
          correctAnswers:
            result.progress.correctAnswers,
          accuracy:
            result.progress.accuracy,
          currentStreak:
            result.progress.currentStreak,
          bestStreak:
            result.progress.bestStreak,
          skillLevel:
            result.progress.skillLevel,
          currentDifficulty:
            result.progress.currentDifficulty,
          weakTopics:
            result.progress.weakTopics || [],
          strongTopics:
            result.progress.strongTopics || [],
        });
      }

      setSessionHistory((previous) => [
        ...previous,
        [
          `Question: ${currentQuestion.question}`,
          `Topic: ${currentQuestion.topic}`,
          `Difficulty: ${currentQuestion.difficulty}`,
          `Student answer: ${answer}`,
          `Correct: ${result.correct}`,
          `Next difficulty: ${result.nextDifficulty}`,
        ].join("\n"),
      ]);
    } catch (err) {
      console.error(
        "Answer analysis error:",
        err
      );

      setError(
        "AI answer analyze nahi kar pa raha. Backend check karo."
      );
    } finally {
      setAgentLoading(false);
    }
  }

  // =========================================================
  // NEXT QUESTION
  // =========================================================

  async function nextQuestion() {
    if (!agentResponse) {
      return;
    }

    const nextDifficulty =
      agentResponse.nextDifficulty;

    setQuestionNumber(
      (previous) => previous + 1
    );

    setAgentResponse(null);
    setSelectedAnswer("");

    await generateQuestion(
      nextDifficulty
    );
  }

  // =========================================================
  // SEND CHAT MESSAGE
  // =========================================================

  async function sendChatMessage() {
    const message = chatInput.trim();

    if (!message || chatLoading) {
      return;
    }

    setChatInput("");

    setChatMessages((previous) => [
      ...previous,
      {
        role: "user",
        content: message,
      },
    ]);

    setChatLoading(true);

    try {
      const response = await fetch(
        `${API_BASE}/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            studentId,
            message,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Chat API returned ${response.status}`
        );
      }

      const data = await response.json();

      if (!data.success || !data.answer) {
        throw new Error(
          "Invalid chat response."
        );
      }

      setChatMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: data.answer,
        },
      ]);
    } catch (err) {
      console.error(
        "Chat error:",
        err
      );

      setChatMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content:
            "Sorry, AI se connection nahi ho pa raha. Backend check karo.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  // =========================================================
  // START CHAT
  // =========================================================

  function openChat() {
    setScreen("chat");

    if (chatMessages.length === 0) {
      setChatMessages([
        {
          role: "assistant",
          content:
            "Hi! Main AceLearn AI hoon. Tum Mathematics, Physics, Chemistry, Biology, JEE, NEET, coding, English ya kisi bhi academic question ke baare mein mujhse pooch sakte ho.",
        },
      ]);
    }
  }

  // =========================================================
  // HOME
  // =========================================================

  if (screen === "home") {
    return (
      <div className="app">
        <nav className="navbar">
          <div className="logo">
            <span className="logo-icon">
              ✦
            </span>
            AceLearn AI
          </div>

          <div className="nav-links">
            <a href="#features">
              Features
            </a>

            <a href="#impact">
              Impact
            </a>

            <button
              className="nav-btn"
              onClick={() =>
                setScreen("setup")
              }
            >
              Try Demo
            </button>

            <button
              className="nav-btn"
              onClick={openChat}
            >
              Ask AI
            </button>
          </div>
        </nav>

        <main>
          <section className="hero">
            <div className="hero-content">
              <div className="badge">
                <span>✦</span>
                AI-POWERED LEARNING AGENT
              </div>

              <h1>
                Your personal
                <br />
                <span>
                  AI Study Agent.
                </span>
              </h1>

              <p className="hero-text">
                Ask questions, solve problems,
                practice with AI-generated
                questions, and get personalized
                feedback based on your performance.
              </p>

              <div className="hero-actions">
                <button
                  className="primary-btn"
                  onClick={() =>
                    setScreen("setup")
                  }
                >
                  Start Learning →
                </button>

                <button
                  className="secondary-btn"
                  onClick={openChat}
                >
                  Ask AI Anything
                </button>
              </div>

              <div className="trust">
                <span>
                  ✓ No sign up
                </span>

                <span>
                  ✓ AI generated questions
                </span>

                <span>
                  ✓ Adaptive learning
                </span>
              </div>
            </div>

            <div className="agent-preview">
              <div className="preview-top">
                <div>
                  <small>
                    YOUR AI STUDY AGENT
                  </small>

                  <h3>
                    Hi{" "}
                    {name || "Student"} 👋
                  </h3>
                </div>

                <div className="online">
                  <span />
                  Active
                </div>
              </div>

              <div className="agent-message">
                <div className="agent-avatar">
                  ✦
                </div>

                <div>
                  <strong>
                    Ask me anything.
                  </strong>

                  <p>
                    I'll explain concepts,
                    solve questions and help
                    you improve.
                  </p>
                </div>
              </div>

              <div className="skills">
                <div className="skill">
                  <div>
                    <span>
                      Accuracy
                    </span>

                    <strong>
                      {Math.round(
                        progress.accuracy
                      )}
                      %
                    </strong>
                  </div>

                  <div className="progress">
                    <span
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            0,
                            progress.accuracy
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="skill">
                  <div>
                    <span>
                      Current Level
                    </span>

                    <strong>
                      {progress.skillLevel}
                    </strong>
                  </div>
                </div>

                <div className="skill">
                  <div>
                    <span>
                      Difficulty
                    </span>

                    <strong>
                      {progress.currentDifficulty}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="recommendation">
                <div>
                  💡
                </div>

                <div>
                  <small>
                    AI RECOMMENDATION
                  </small>

                  <p>
                    {progress.accuracy < 50
                      ? "Let's strengthen your weak topics first."
                      : "Keep practicing and increase the difficulty gradually."}
                  </p>
                </div>
              </div>

              <button
                className="session-btn"
                onClick={startSession}
              >
                Start AI Practice →
              </button>
            </div>
          </section>

          <section
            className="features"
            id="features"
          >
            <div className="section-heading">
              <p className="eyebrow">
                BUILT FOR STUDENTS
              </p>

              <h2>
                More than a chatbot.
                <br />
                <span>
                  An agent that acts.
                </span>
              </h2>
            </div>

            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">
                  🧠
                </div>

                <h3>
                  Ask anything
                </h3>

                <p>
                  Ask academic questions and
                  get direct explanations from
                  the AI.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">
                  🎯
                </div>

                <h3>
                  Adaptive practice
                </h3>

                <p>
                  Questions are generated
                  dynamically according to
                  your selected topic and level.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">
                  📈
                </div>

                <h3>
                  Tracks progress
                </h3>

                <p>
                  Your answers are analyzed
                  and saved to your learning
                  profile.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // =========================================================
  // SETUP
  // =========================================================

  if (screen === "setup") {
    return (
      <div className="app">
        <nav className="navbar">
          <div className="logo">
            <span className="logo-icon">
              ✦
            </span>
            AceLearn AI
          </div>

          <button
            className="back-btn"
            onClick={() =>
              setScreen("home")
            }
          >
            ← Back
          </button>
        </nav>

        <main className="setup-page">
          <div className="setup-header">
            <div className="setup-icon">
              🧠
            </div>

            <p className="eyebrow">
              AI LEARNING SETUP
            </p>

            <h1>
              Let's personalize
              <br />
              <span>
                your learning.
              </span>
            </h1>

            <p>
              Select your exam, subject,
              topic and difficulty. AceLearn
              AI will generate fresh questions.
            </p>
          </div>

          <div className="setup-card">
            <label>
              Your name
            </label>

            <input
              type="text"
              placeholder="Enter your name"
              value={name}
              onChange={(event) =>
                setName(
                  event.target.value
                )
              }
            />

            <label>
              Exam / Level
            </label>

            <div className="option-grid">
              {[
                "JEE Main",
                "JEE Advanced",
                "NEET",
                "SAT",
                "Class 12",
                "General Study",
              ].map((item) => (
                <button
                  key={item}
                  className={
                    level === item
                      ? "option active"
                      : "option"
                  }
                  onClick={() =>
                    setLevel(item)
                  }
                >
                  <span>
                    🎯
                  </span>

                  <div>
                    <strong>
                      {item}
                    </strong>

                    <small>
                      Personalized AI practice
                    </small>
                  </div>
                </button>
              ))}
            </div>

            <label>
              Subject
            </label>

            <select
              value={subject}
              onChange={(event) =>
                setSubject(
                  event.target.value
                )
              }
            >
              <option>
                Mathematics
              </option>

              <option>
                Physics
              </option>

              <option>
                Chemistry
              </option>

              <option>
                Biology
              </option>

              <option>
                Computer Science
              </option>

              <option>
                English
              </option>
            </select>

            <label>
              Topic
            </label>

            <input
              type="text"
              value={topic}
              placeholder="Example: Quadratic Equations"
              onChange={(event) =>
                setTopic(
                  event.target.value
                )
              }
            />

            <label>
              Difficulty
            </label>

            <div className="time-grid">
              {(
                [
                  "easy",
                  "medium",
                  "hard",
                ] as Difficulty[]
              ).map((item) => (
                <button
                  key={item}
                  className={
                    difficulty === item
                      ? "selected"
                      : ""
                  }
                  onClick={() =>
                    setDifficulty(item)
                  }
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>

            <label>
              Daily study time
            </label>

            <div className="time-grid">
              {[
                "30 min",
                "1 hour",
                "2 hours",
              ].map((item) => (
                <button
                  key={item}
                  className={
                    studyTime === item
                      ? "selected"
                      : ""
                  }
                  onClick={() =>
                    setStudyTime(item)
                  }
                >
                  {item}
                </button>
              ))}
            </div>

            {error && (
              <div className="agent-thinking error-box">
                <div className="agent-avatar">
                  !
                </div>

                <div>
                  <strong>
                    Error
                  </strong>

                  <p>
                    {error}
                  </p>
                </div>
              </div>
            )}

            <button
              className="primary-btn full"
              onClick={startSession}
              disabled={loadingQuestion}
            >
              {loadingQuestion
                ? "Preparing AI..."
                : "Start AI Practice →"}
            </button>

            <button
              className="secondary-btn full"
              onClick={openChat}
            >
              Ask AI a Question
            </button>

            <p className="privacy-note">
              No account required • Your
              learning progress is saved locally
              for this demo.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // =========================================================
  // SESSION
  // =========================================================

  if (screen === "session") {
    return (
      <div className="app">
        <nav className="navbar">
          <div className="logo">
            <span className="logo-icon">
              ✦
            </span>
            AceLearn AI
          </div>

          <div className="dashboard-status">
            <span className="status-dot" />
            AI Agent Active
          </div>
        </nav>

        <main className="session-page">
          <div className="session-header">
            <div>
              <p className="eyebrow">
                TODAY'S AI SESSION
              </p>

              <h1>
                {subject} Practice
              </h1>

              <p>
                {level} • {topic}
              </p>
            </div>

            <div className="session-progress-text">
              Question{" "}
              {questionNumber}
            </div>
          </div>

          <div className="adaptive-status">
            <div className="agent-avatar">
              ✦
            </div>

            <div>
              <strong>
                AI Agent is active
              </strong>

              <p>
                Current difficulty:
                <span className="difficulty">
                  {" "}
                  {(
                    currentQuestion?.difficulty ||
                    difficulty
                  ).toUpperCase()}
                </span>
              </p>
            </div>
          </div>

          {loadingQuestion && (
            <div className="agent-thinking">
              <div className="agent-avatar">
                ✦
              </div>

              <div>
                <strong>
                  Generating a fresh question...
                </strong>

                <p>
                  AceLearn AI is creating a
                  new question for you.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="agent-thinking error-box">
              <div className="agent-avatar">
                !
              </div>

              <div>
                <strong>
                  Connection problem
                </strong>

                <p>
                  {error}
                </p>

                <button
                  className="secondary-btn"
                  onClick={() =>
                    generateQuestion(
                      difficulty
                    )
                  }
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {currentQuestion &&
            !loadingQuestion && (
              <div className="session-question-card">
                <div className="question-meta">
                  <span>
                    {currentQuestion.subject}
                  </span>

                  <span>
                    {currentQuestion.topic}
                  </span>

                  <span>
                    {currentQuestion.difficulty}
                  </span>
                </div>

                <h2>
                  {currentQuestion.question}
                </h2>

                <div className="answers">
                  {currentQuestion.options.map(
                    (option, index) => {
                      const isSelected =
                        selectedAnswer ===
                        option;

                      const isCorrect =
                        agentResponse &&
                        option ===
                          currentQuestion.correctAnswer;

                      const isWrongSelected =
                        agentResponse &&
                        isSelected &&
                        !agentResponse.correct;

                      let className =
                        "answer";

                      if (isSelected) {
                        className +=
                          " selected-answer";
                      }

                      if (isCorrect) {
                        className +=
                          " correct-answer";
                      }

                      if (
                        isWrongSelected
                      ) {
                        className +=
                          " wrong-answer";
                      }

                      return (
                        <button
                          key={`${option}-${index}`}
                          className={
                            className
                          }
                          disabled={
                            agentLoading ||
                            Boolean(
                              agentResponse
                            )
                          }
                          onClick={() =>
                            submitAnswer(
                              option
                            )
                          }
                        >
                          <span className="answer-letter">
                            {String.fromCharCode(
                              65 + index
                            )}
                          </span>

                          <span>
                            {option}
                          </span>

                          {isCorrect && (
                            <span className="check">
                              ✓
                            </span>
                          )}

                          {isWrongSelected && (
                            <span className="check">
                              ✕
                            </span>
                          )}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>
            )}

          {agentLoading && (
            <div className="agent-thinking">
              <div className="agent-avatar">
                ✦
              </div>

              <div>
                <strong>
                  AceLearn AI is thinking...
                </strong>

                <p>
                  I'm checking your answer
                  and deciding what you should
                  practice next.
                </p>
              </div>
            </div>
          )}

          {agentResponse &&
            !agentLoading &&
            currentQuestion && (
              <div className="agent-result">
                <div className="agent-avatar">
                  {agentResponse.correct
                    ? "✓"
                    : "!"}
                </div>

                <div className="agent-result-content">
                  <div className="agent-result-header">
                    <div>
                      <small>
                        AI AGENT
                      </small>

                      <h3>
                        {agentResponse.correct
                          ? "Correct Answer! 🎉"
                          : "Not quite — let's fix it."}
                      </h3>
                    </div>

                    <span
                      className={
                        agentResponse.correct
                          ? "result-correct"
                          : "result-review"
                      }
                    >
                      {agentResponse.correct
                        ? "Correct"
                        : "Incorrect"}
                    </span>
                  </div>

                  <p className="agent-feedback">
                    {agentResponse.feedback}
                  </p>

                  {!agentResponse.correct && (
                    <div className="agent-recommendation">
                      <strong>
                        ✓ Correct answer
                      </strong>

                      <p>
                        {agentResponse.correctAnswer ||
                          currentQuestion.correctAnswer}
                      </p>
                    </div>
                  )}

                  <div className="agent-recommendation">
                    <strong>
                      📘 Explanation
                    </strong>

                    <p>
                      {agentResponse.explanation ||
                        currentQuestion.explanation ||
                        "No explanation was returned."}
                    </p>
                  </div>

                  {agentResponse.mistake && (
                    <div className="agent-reason">
                      <small>
                        WHAT WENT WRONG
                      </small>

                      <p>
                        {agentResponse.mistake}
                      </p>
                    </div>
                  )}

                  <div className="agent-decision-box">
                    <div>
                      <small>
                        NEXT DIFFICULTY
                      </small>

                      <strong>
                        {agentResponse.nextDifficulty.toUpperCase()}
                      </strong>
                    </div>

                    <div>
                      <small>
                        SKILL LEVEL
                      </small>

                      <strong>
                        {agentResponse.skillLevel}
                      </strong>
                    </div>

                    <div>
                      <small>
                        SCORE
                      </small>

                      <strong>
                        {sessionScore}/
                        {sessionTotal}
                      </strong>
                    </div>
                  </div>

                  <div className="agent-recommendation">
                    <strong>
                      🎯 Agent recommendation
                    </strong>

                    <p>
                      {agentResponse.recommendation}
                    </p>
                  </div>

                  <div className="agent-reason">
                    <small>
                      WHY THE AGENT DECIDED THIS
                    </small>

                    <p>
                      {agentResponse.agentDecision}
                    </p>
                  </div>

                  <button
                    className="primary-btn"
                    onClick={nextQuestion}
                  >
                    Generate Next Question →
                  </button>

                  <button
                    className="secondary-btn"
                    onClick={() =>
                      setScreen("dashboard")
                    }
                  >
                    Back to Dashboard
                  </button>
                </div>
              </div>
            )}
        </main>
      </div>
    );
  }

  // =========================================================
  // CHAT
  // =========================================================

  if (screen === "chat") {
    return (
      <div className="app">
        <nav className="navbar">
          <div className="logo">
            <span className="logo-icon">
              ✦
            </span>
            AceLearn AI
          </div>

          <button
            className="back-btn"
            onClick={() =>
              setScreen("home")
            }
          >
            ← Home
          </button>
        </nav>

        <main className="session-page">
          <div className="session-header">
            <div>
              <p className="eyebrow">
                AI STUDY ASSISTANT
              </p>

              <h1>
                Ask AceLearn AI
              </h1>

              <p>
                Ask questions from any subject
                and get step-by-step help.
              </p>
            </div>
          </div>

          <div className="agent-result">
            <div
              className="agent-result-content"
              style={{
                width: "100%",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                  maxHeight: "500px",
                  overflowY: "auto",
                  marginBottom: "20px",
                }}
              >
                {chatMessages.map(
                  (message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      style={{
                        padding: "16px",
                        borderRadius:
                          "14px",
                        background:
                          message.role ===
                          "user"
                            ? "rgba(99,102,241,0.12)"
                            : "rgba(255,255,255,0.06)",
                      }}
                    >
                      <strong>
                        {message.role ===
                        "user"
                          ? "You"
                          : "AceLearn AI"}
                      </strong>

                      <p
                        style={{
                          whiteSpace:
                            "pre-wrap",
                          marginTop: "8px",
                        }}
                      >
                        {message.content}
                      </p>
                    </div>
                  )
                )}

                {chatLoading && (
                  <div
                    className="agent-thinking"
                  >
                    <div className="agent-avatar">
                      ✦
                    </div>

                    <div>
                      <strong>
                        AceLearn AI is
                        thinking...
                      </strong>

                      <p>
                        Preparing your
                        answer.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "stretch",
                }}
              >
                <input
                  type="text"
                  value={chatInput}
                  placeholder="Ask anything..."
                  onChange={(event) =>
                    setChatInput(
                      event.target.value
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter"
                    ) {
                      void sendChatMessage();
                    }
                  }}
                  disabled={chatLoading}
                  style={{
                    flex: 1,
                  }}
                />

                <button
                  className="primary-btn"
                  onClick={() =>
                    void sendChatMessage()
                  }
                  disabled={
                    chatLoading ||
                    !chatInput.trim()
                  }
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // =========================================================
  // DASHBOARD
  // =========================================================

  if (screen === "dashboard") {
    return (
      <div className="app">
        <nav className="navbar">
          <div className="logo">
            <span className="logo-icon">
              ✦
            </span>
            AceLearn AI
          </div>

          <div className="dashboard-status">
            <span className="status-dot" />
            AI Agent Active
          </div>
        </nav>

        <main className="dashboard-page">
          <div className="dashboard-header">
            <div>
              <p className="eyebrow">
                PERSONALIZED LEARNING
              </p>

              <h1>
                Good to see you
                {name
                  ? `, ${name}`
                  : ""}{" "}
                👋
              </h1>

              <p>
                Your AI learning profile is
                updated from your latest
                answers.
              </p>
            </div>

            <div className="streak-card">
              <span>
                🔥
              </span>

              <div>
                <strong>
                  {progress.currentStreak}{" "}
                  question streak
                </strong>

                <small>
                  Best:{" "}
                  {progress.bestStreak}
                </small>
              </div>
            </div>
          </div>

          <section className="agent-decision">
            <div className="agent-avatar large">
              ✦
            </div>

            <div className="decision-content">
              <div className="decision-title">
                <span>
                  AI AGENT STATUS
                </span>
              </div>

              <h2>
                Your learning profile
                is adapting.
              </h2>

              <p>
                Accuracy:{" "}
                {Math.round(
                  progress.accuracy
                )}
                % • Skill:{" "}
                {progress.skillLevel} •
                Next difficulty:{" "}
                {
                  progress.currentDifficulty
                }
              </p>

              <div className="decision-tags">
                <span>
                  🎯 Adaptive
                </span>

                <span>
                  📈 Progress tracked
                </span>

                <span>
                  🧠 AI personalized
                </span>
              </div>
            </div>
          </section>

          <div className="dashboard-grid">
            <section className="dashboard-card">
              <div className="card-heading">
                <div>
                  <small>
                    PERFORMANCE
                  </small>

                  <h2>
                    Your progress
                  </h2>
                </div>
              </div>

              <div className="dashboard-skill">
                <div>
                  <span>
                    Accuracy
                  </span>

                  <strong>
                    {Math.round(
                      progress.accuracy
                    )}
                    %
                  </strong>
                </div>

                <div className="dashboard-progress">
                  <span
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          progress.accuracy
                        )
                      )}%`,
                    }}
                  />
                </div>

                <small>
                  {progress.correctAnswers}{" "}
                  correct out of{" "}
                  {progress.totalAttempts}
                </small>
              </div>

              <div className="dashboard-skill">
                <div>
                  <span>
                    Skill Level
                  </span>

                  <strong>
                    {progress.skillLevel}
                  </strong>
                </div>
              </div>

              <div className="dashboard-skill">
                <div>
                  <span>
                    Next Difficulty
                  </span>

                  <strong>
                    {
                      progress.currentDifficulty
                    }
                  </strong>
                </div>
              </div>
            </section>

            <section className="dashboard-card">
              <div className="card-heading">
                <div>
                  <small>
                    CURRENT PRACTICE
                  </small>

                  <h2>
                    {topic}
                  </h2>
                </div>
              </div>

              <p>
                {subject} • {level}
              </p>

              <button
                className="primary-btn"
                onClick={startSession}
              >
                Start Practice →
              </button>

              <button
                className="secondary-btn"
                onClick={openChat}
              >
                Ask AI
              </button>
            </section>
          </div>

          <section className="dashboard-card next-action">
            <div className="next-icon">
              ✦
            </div>

            <div>
              <small>
                NEXT ACTION
              </small>

              <h3>
                Continue your adaptive
                practice
              </h3>

              <p>
                AceLearn will generate a
                fresh question based on
                your current level.
              </p>
            </div>

            <button
              className="secondary-btn"
              onClick={startSession}
            >
              Continue
            </button>
          </section>
        </main>
      </div>
    );
  }

  // =========================================================
  // ASSESSMENT
  // =========================================================

  if (screen === "assessment") {
    return (
      <div className="app">
        <nav className="navbar">
          <div className="logo">
            <span className="logo-icon">
              ✦
            </span>
            AceLearn AI
          </div>
        </nav>

        <main className="analysis-page">
          <div className="analysis-icon">
            ✦
          </div>

          <p className="eyebrow">
            AI ASSESSMENT
          </p>

          <h1>
            Assessment is now
            <br />
            <span>
              AI generated.
            </span>
          </h1>

          <p className="analysis-description">
            Instead of using the old fixed
            questions, AceLearn now generates
            fresh questions through the backend.
          </p>

          <div className="agent-plan">
            <div className="agent-avatar">
              ✦
            </div>

            <div>
              <small>
                SELECTED CONFIGURATION
              </small>

              <h3>
                {level} • {subject}
              </h3>

              <p>
                Topic: {topic}
                <br />
                Difficulty: {difficulty}
                <br />
                Study time: {studyTime}
              </p>
            </div>
          </div>

          <button
            className="primary-btn analysis-button"
            onClick={startSession}
          >
            Start AI Generated Practice →
          </button>

          <button
            className="secondary-btn"
            onClick={openChat}
          >
            Ask AI First
          </button>
        </main>
      </div>
    );
  }

  // =========================================================
  // RESULTS
  // =========================================================

  if (screen === "results") {
    const percentage =
      sessionTotal === 0
        ? 0
        : Math.round(
            (sessionScore /
              sessionTotal) *
              100
          );

    return (
      <div className="app">
        <nav className="navbar">
          <div className="logo">
            <span className="logo-icon">
              ✦
            </span>
            AceLearn AI
          </div>

          <div className="dashboard-status">
            <span className="status-dot" />
            Session Complete
          </div>
        </nav>

        <main className="results-page">
          <div className="results-icon">
            ✓
          </div>

          <p className="eyebrow">
            AI SESSION COMPLETE
          </p>

          <h1>
            Practice complete
            {name
              ? `, ${name}`
              : ""}!
          </h1>

          <p className="results-description">
            Your answers were analyzed and
            saved to your learning profile.
          </p>

          <div className="result-score-card">
            <div className="result-score">
              <strong>
                {percentage}%
              </strong>

              <span>
                Session Score
              </span>
            </div>

            <div>
              <h3>
                {sessionScore} correct
                out of{" "}
                {sessionTotal}
              </h3>

              <p>
                Current overall accuracy:{" "}
                {Math.round(
                  progress.accuracy
                )}
                %
              </p>
            </div>
          </div>

          {agentResponse && (
            <div className="agent-result">
              <div className="agent-avatar">
                ✦
              </div>

              <div>
                <small>
                  AI AGENT UPDATE
                </small>

                <h3>
                  Your next step
                </h3>

                <p>
                  {
                    agentResponse.recommendation
                  }
                </p>
              </div>
            </div>
          )}

          <div className="result-actions">
            <button
              className="primary-btn"
              onClick={startSession}
            >
              Practice Again →
            </button>

            <button
              className="secondary-btn"
              onClick={() =>
                setScreen("dashboard")
              }
            >
              Dashboard
            </button>

            <button
              className="secondary-btn"
              onClick={openChat}
            >
              Ask AI
            </button>
          </div>
        </main>
      </div>
    );
  }

  return null;
}

export default App;