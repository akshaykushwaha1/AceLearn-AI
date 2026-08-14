import { useEffect, useState } from "react";

type Screen =
  | "home"
  | "setup"
  | "assessment"
  | "analysis"
  | "dashboard"
  | "session"
  | "results";

type Difficulty = "easy" | "medium" | "hard";

type Question = {
  subject: string;
  topic: string;
  difficulty: Difficulty;
  question: string;
  options: string[];
  answer: string;
};

type AgentResponse = {
  correct: boolean;
  skillLevel: string;
  feedback: string;
  nextDifficulty: Difficulty;
  recommendation: string;
  agentDecision: string;
  nextTopic?: string;
  action?: string;
  progress?: {
    totalAttempts: number;
    correctAnswers: number;
    accuracy: number;
    currentStreak: number;
    bestStreak: number;
    skillLevel: string;
    currentDifficulty: Difficulty;
    weakTopics: string[];
    strongTopics: string[];
  };
};

type StudentProgress = {
  id: string;
  total_attempts: number;
  correct_answers: number;
  accuracy: number;
  current_streak: number;
  best_streak: number;
  skill_level: string;
  current_difficulty: Difficulty;
  last_recommendation: string;
  created_at: string;
  updated_at: string;
};

type ProgressData = {
  success: boolean;
  student: StudentProgress;
  attempts: Array<{
    id: number;
    student_id: string;
    question: string;
    topic: string;
    difficulty: Difficulty;
    student_answer: string;
    correct_answer: string;
    correct: number;
    recommendation: string;
    next_topic: string;
    created_at: string;
  }>;
  topics: Array<{
    student_id: string;
    topic: string;
    attempts: number;
    correct: number;
    accuracy: number;
  }>;
};

const diagnosticQuestions: Question[] = [
  {
    subject: "Math",
    topic: "Algebra",
    difficulty: "easy",
    question: "If 2x + 6 = 18, what is the value of x?",
    options: ["4", "6", "8", "12"],
    answer: "6",
  },
  {
    subject: "Math",
    topic: "Functions",
    difficulty: "medium",
    question: "If f(x) = 2x + 3, what is f(4)?",
    options: ["7", "9", "11", "12"],
    answer: "11",
  },
  {
    subject: "Reading",
    topic: "Main Idea",
    difficulty: "easy",
    question:
      "A passage explains how regular exercise can improve memory and concentration. What is the main idea?",
    options: [
      "Exercise is only useful for athletes.",
      "Exercise can support brain function and learning.",
      "Memory cannot be improved.",
      "Students should avoid physical activity.",
    ],
    answer:
      "Exercise can support brain function and learning.",
  },
  {
    subject: "Writing",
    topic: "Grammar",
    difficulty: "easy",
    question:
      "Which sentence is grammatically correct?",
    options: [
      "She don't like mathematics.",
      "She doesn't likes mathematics.",
      "She doesn't like mathematics.",
      "She not like mathematics.",
    ],
    answer: "She doesn't like mathematics.",
  },
  {
    subject: "Math",
    topic: "Geometry",
    difficulty: "medium",
    question:
      "A triangle has angles of 50° and 60°. What is the measure of the third angle?",
    options: ["60°", "70°", "80°", "90°"],
    answer: "70°",
  },
];

const adaptiveQuestions: Question[] = [
  {
    subject: "Math",
    topic: "Linear Equations",
    difficulty: "easy",
    question: "If 2x + 4 = 12, what is x?",
    options: ["2", "4", "6", "8"],
    answer: "4",
  },
  {
    subject: "Math",
    topic: "Algebra",
    difficulty: "medium",
    question: "If 3x - 7 = 14, what is x?",
    options: ["5", "6", "7", "8"],
    answer: "7",
  },
  {
    subject: "Math",
    topic: "Quadratic Equations",
    difficulty: "hard",
    question:
      "If x² - 5x + 6 = 0, which values of x satisfy the equation?",
    options: [
      "1 and 6",
      "2 and 3",
      "3 and 4",
      "2 and 4",
    ],
    answer: "2 and 3",
  },
];

function App() {
  const [screen, setScreen] = useState<Screen>("home");

  const [name, setName] = useState("");

  const [studentId] = useState(() => {
    const saved = localStorage.getItem("acelearn_student_id");
    if (saved) return saved;

    const id = `student-${crypto.randomUUID()}`;
    localStorage.setItem("acelearn_student_id", id);
    return id;
  });

  const [progressData, setProgressData] =
    useState<ProgressData | null>(null);

  const [progressLoading, setProgressLoading] =
    useState(false);

  const [progressError, setProgressError] =
    useState("");

  const [currentQuestion, setCurrentQuestion] =
    useState(0);

  const [selectedAnswer, setSelectedAnswer] =
    useState("");

  const [diagnosticScore, setDiagnosticScore] =
    useState(0);

  const [sessionQuestion, setSessionQuestion] =
    useState(0);

  const [sessionScore, setSessionScore] =
    useState(0);

  const [agentResponse, setAgentResponse] =
    useState<AgentResponse | null>(null);

  const [agentLoading, setAgentLoading] =
    useState(false);

  const [sessionError, setSessionError] =
    useState("");

  const [currentDifficulty, setCurrentDifficulty] =
    useState<Difficulty>("easy");

  const [sessionHistory, setSessionHistory] =
    useState<string[]>([]);

  // ================================
  // LOAD REAL STUDENT PROGRESS
  // ================================

  async function loadProgress() {
    setProgressLoading(true);
    setProgressError("");

    try {
      const response = await fetch(
        `/api/students/${studentId}/progress`
      );

      if (response.status === 404) {
        setProgressData(null);
        return;
      }

      if (!response.ok) {
        throw new Error(
          `Backend returned ${response.status}`
        );
      }

      const data: ProgressData =
        await response.json();

      if (!data.success) {
        throw new Error(
          "Invalid progress response."
        );
      }

      setProgressData(data);
    } catch (error) {
      console.error(
        "AceLearn progress error:",
        error
      );
      setProgressError(
        "Progress load nahi ho pa raha. Backend check karo."
      );
    } finally {
      setProgressLoading(false);
    }
  }

  useEffect(() => {
    const savedName = localStorage.getItem(
      "acelearn_student_name"
    );
    if (savedName) setName(savedName);
  }, []);

  useEffect(() => {
    if (
      screen === "dashboard" ||
      screen === "results"
    ) {
      void loadProgress();
    }
  }, [screen, studentId]);

  // ================================
  // START ASSESSMENT
  // ================================

  function startAssessment() {
    setCurrentQuestion(0);
    setSelectedAnswer("");
    setDiagnosticScore(0);
    setScreen("assessment");
  }

  // ================================
  // DIAGNOSTIC ANSWER
  // ================================

  function submitDiagnosticAnswer() {
    if (!selectedAnswer) return;

    const question =
      diagnosticQuestions[currentQuestion];

    const isCorrect =
      selectedAnswer === question.answer;

    const newScore = isCorrect
      ? diagnosticScore + 1
      : diagnosticScore;

    setDiagnosticScore(newScore);
    setSelectedAnswer("");

    if (
      currentQuestion ===
      diagnosticQuestions.length - 1
    ) {
      setScreen("analysis");
      return;
    }

    setCurrentQuestion(
      currentQuestion + 1
    );
  }

  // ================================
  // START AI SESSION
  // ================================

  function startSession() {
    setSessionQuestion(0);
    setSessionScore(0);
    setAgentResponse(null);
    setAgentLoading(false);
    setSessionError("");
    setCurrentDifficulty("easy");
    setSessionHistory([]);
    setSelectedAnswer("");
    setScreen("session");
  }

  // ================================
  // REAL GROQ AI AGENT
  // ================================

  async function askAgent(
    question: Question,
    studentAnswer: string
  ) {
    setAgentLoading(true);
    setSessionError("");
    setAgentResponse(null);

    try {
      const response = await fetch(
        "/api/agent/analyze",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            studentId,
            question: question.question,

            options: question.options,

            correctAnswer: question.answer,

            studentAnswer,

            topic: question.topic,

            difficulty: currentDifficulty,

            previousPerformance:
              sessionHistory.length > 0
                ? sessionHistory.join("\n")
                : "No previous performance.",
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Backend returned ${response.status}`
        );
      }

      const data = await response.json();

      if (!data.success || !data.agent) {
        throw new Error(
          "Invalid AI response received."
        );
      }

      const agent: AgentResponse =
        data.agent;

      setAgentResponse(agent);

      setCurrentDifficulty(
        agent.nextDifficulty
      );

      setSessionHistory((previous) => [
        ...previous,
        `Topic: ${question.topic}
Difficulty: ${currentDifficulty}
Student answer: ${studentAnswer}
Correct: ${agent.correct}
AI decision: ${agent.agentDecision}`,
      ]);

      if (agent.correct) {
        setSessionScore(
          (score) => score + 1
        );
      }

      // Refresh persistent SQLite progress after every answer.
      void loadProgress();
    } catch (error) {
      console.error(
        "AceLearn AI Agent Error:",
        error
      );

      setSessionError(
        "AI Agent se connection nahi ho pa raha. Please make sure backend port 3001 is running."
      );
    } finally {
      setAgentLoading(false);
    }
  }

  // ================================
  // SESSION ANSWER
  // ================================

  async function submitSessionAnswer(
    answer: string
  ) {
    if (agentLoading) return;

    setSelectedAnswer(answer);

    const question =
      adaptiveQuestions[sessionQuestion];

    await askAgent(
      question,
      answer
    );
  }

  // ================================
  // NEXT QUESTION
  // ================================

  function nextSessionQuestion() {
    setAgentResponse(null);
    setSelectedAnswer("");

    if (
      sessionQuestion ===
      adaptiveQuestions.length - 1
    ) {
      setScreen("results");
      return;
    }

    setSessionQuestion(
      sessionQuestion + 1
    );
  }

  // ================================
  // HOME
  // ================================

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
                AceLearn understands where you
                struggle, builds your personalized
                study plan, and adapts every
                session to help you improve.
              </p>

              <div className="hero-actions">

                <button
                  className="primary-btn"
                  onClick={() =>
                    setScreen("setup")
                  }
                >
                  Start Assessment →
                </button>

                <button
                  className="secondary-btn"
                  onClick={() =>
                    setScreen("setup")
                  }
                >
                  Try Demo
                </button>

              </div>

              <div className="trust">

                <span>
                  ✓ No sign up
                </span>

                <span>
                  ✓ Personalized
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
                    Good evening, Alex 👋
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
                    I've noticed something...
                  </strong>

                  <p>
                    You're doing great in
                    Reading, but Algebra needs
                    a little more practice.
                  </p>
                </div>

              </div>

              <div className="skills">

                <div className="skill">

                  <div>
                    <span>
                      Math
                    </span>

                    <strong>
                      72%
                    </strong>
                  </div>

                  <div className="progress">
                    <span
                      style={{
                        width: "72%",
                      }}
                    />
                  </div>

                </div>

                <div className="skill">

                  <div>
                    <span>
                      Reading
                    </span>

                    <strong>
                      61%
                    </strong>
                  </div>

                  <div className="progress">
                    <span
                      style={{
                        width: "61%",
                      }}
                    />
                  </div>

                </div>

                <div className="skill">

                  <div>
                    <span>
                      Writing
                    </span>

                    <strong>
                      84%
                    </strong>
                  </div>

                  <div className="progress">
                    <span
                      style={{
                        width: "84%",
                      }}
                    />
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
                    Review linear equations
                    before moving to advanced
                    algebra.
                  </p>

                </div>

              </div>

              <button
                className="session-btn"
                onClick={() =>
                  setScreen("setup")
                }
              >
                Continue Session →
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
                  Finds your weaknesses
                </h3>

                <p>
                  Analyzes your answers to
                  understand exactly where
                  you need help.
                </p>

              </div>

              <div className="feature-card">

                <div className="feature-icon">
                  🎯
                </div>

                <h3>
                  Adapts to you
                </h3>

                <p>
                  Questions become easier or
                  harder based on your actual
                  performance.
                </p>

              </div>

              <div className="feature-card">

                <div className="feature-icon">
                  📈
                </div>

                <h3>
                  Tracks your growth
                </h3>

                <p>
                  Your agent continuously
                  monitors progress and updates
                  your study plan.
                </p>

              </div>

            </div>

          </section>

        </main>

      </div>
    );
  }

  // ================================
  // SETUP
  // ================================

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
              AI DIAGNOSTIC ASSESSMENT
            </p>

            <h1>
              Let's understand
              <br />
              <span>
                how you learn.
              </span>
            </h1>

            <p>
              Answer a few questions and your AI
              Study Agent will identify your
              strengths, weaknesses, and create
              your personalized plan.
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
              onChange={(e) => {
                const value = e.target.value;
                setName(value);
                localStorage.setItem(
                  "acelearn_student_name",
                  value
                );
              }}
            />

            <label>
              What are you preparing for?
            </label>

            <div className="option-grid">

              <button className="option active">

                <span>
                  🎯
                </span>

                <div>
                  <strong>
                    SAT
                  </strong>

                  <small>
                    College entrance exam
                  </small>
                </div>

              </button>

              <button className="option">

                <span>
                  📚
                </span>

                <div>
                  <strong>
                    General Study
                  </strong>

                  <small>
                    Improve academic skills
                  </small>
                </div>

              </button>

            </div>

            <label>
              Daily study time
            </label>

            <div className="time-grid">

              <button>
                30 min
              </button>

              <button className="selected">
                1 hour
              </button>

              <button>
                2 hours
              </button>

            </div>

            <button
              className="primary-btn full"
              onClick={startAssessment}
            >
              Start Diagnostic →
            </button>

            <p className="privacy-note">
              No account required • Your session
              is private
            </p>

          </div>

        </main>

      </div>
    );
  }

  // ================================
  // ASSESSMENT
  // ================================

  if (screen === "assessment") {
    const question =
      diagnosticQuestions[currentQuestion];

    const progress =
      ((currentQuestion + 1) /
        diagnosticQuestions.length) *
      100;

    return (
      <div className="app">

        <nav className="navbar">

          <div className="logo">
            <span className="logo-icon">
              ✦
            </span>

            AceLearn AI
          </div>

          <div className="assessment-label">
            AI Diagnostic Assessment
          </div>

        </nav>

        <main className="assessment-page">

          <div className="assessment-top">

            <div>

              <p className="eyebrow">
                DIAGNOSTIC TEST
              </p>

              <h1>
                Let's find your
                <br />
                <span>
                  learning gaps.
                </span>
              </h1>

            </div>

            <div className="question-counter">
              <strong>
                {currentQuestion + 1}
              </strong>

              <span>
                {" "}
                /{" "}
                {diagnosticQuestions.length}
              </span>
            </div>

          </div>

          <div className="assessment-progress">

            <div
              style={{
                width: `${progress}%`,
              }}
            />

          </div>

          <div className="question-card">

            <div className="question-meta">

              <span>
                {question.subject}
              </span>

              <span>
                {question.topic}
              </span>

            </div>

            <h2>
              {question.question}
            </h2>

            <div className="answers">

              {question.options.map(
                (option, index) => (

                  <button
                    key={option}
                    className={
                      selectedAnswer === option
                        ? "answer selected-answer"
                        : "answer"
                    }
                    onClick={() =>
                      setSelectedAnswer(option)
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

                    {selectedAnswer ===
                      option && (
                      <span className="check">
                        ✓
                      </span>
                    )}

                  </button>

                )
              )}

            </div>

            <div className="question-footer">

              <span>
                Choose the answer you think is
                correct.
              </span>

              <button
                className="primary-btn"
                disabled={!selectedAnswer}
                onClick={
                  submitDiagnosticAnswer
                }
              >

                {currentQuestion ===
                diagnosticQuestions.length - 1
                  ? "Finish Assessment"
                  : "Next Question →"}

              </button>

            </div>

          </div>

          <div className="agent-tip">

            <div className="agent-avatar">
              ✦
            </div>

            <div>

              <strong>
                Your AI Agent is watching your
                progress
              </strong>

              <p>
                Your answers will help me
                understand which skills need
                more practice.
              </p>

            </div>

          </div>

        </main>

      </div>
    );
  }

  // ================================
  // ANALYSIS
  // ================================

  if (screen === "analysis") {
    const percentage = Math.round(
      (diagnosticScore /
        diagnosticQuestions.length) *
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

        </nav>

        <main className="analysis-page">

          <div className="analysis-icon">
            ✦
          </div>

          <p className="eyebrow">
            AI ANALYSIS COMPLETE
          </p>

          <h1>
            I've learned how
            <br />
            <span>
              you learn.
            </span>
          </h1>

          <p className="analysis-description">
            Your AI Study Agent analyzed your
            answers and created a personalized
            learning strategy for you.
          </p>

          <div className="score-card">

            <div className="score-circle">

              <strong>
                {percentage}%
              </strong>

              <span>
                Diagnostic
              </span>

            </div>

            <div className="score-info">

              <h3>
                {name
                  ? `${name}, here's what I found.`
                  : "Here's what I found."}
              </h3>

              <p>
                You have a good foundation, but
                there are a few areas where
                targeted practice can make a big
                difference.
              </p>

            </div>

          </div>

          <div className="analysis-grid">

            <div className="analysis-card">

              <span className="analysis-card-icon">
                💪
              </span>

              <small>
                YOUR STRENGTH
              </small>

              <h3>
                Reading & Writing
              </h3>

              <p>
                You're showing strong
                comprehension and grammar
                skills.
              </p>

            </div>

            <div className="analysis-card">

              <span className="analysis-card-icon">
                🎯
              </span>

              <small>
                NEEDS ATTENTION
              </small>

              <h3>
                Math & Algebra
              </h3>

              <p>
                Let's strengthen your algebra
                fundamentals before moving to
                advanced problems.
              </p>

            </div>

          </div>

          <div className="agent-plan">

            <div className="agent-avatar">
              ✦
            </div>

            <div>

              <small>
                YOUR AI AGENT'S PLAN
              </small>

              <h3>
                I've created your personalized
                learning path.
              </h3>

              <p>
                We'll start with Algebra
                fundamentals, then gradually
                increase difficulty as your
                accuracy improves.
              </p>

            </div>

          </div>

          <button
            className="primary-btn analysis-button"
            onClick={() =>
              setScreen("dashboard")
            }
          >
            View My Learning Dashboard →
          </button>

        </main>

      </div>
    );
  }

  // ================================
  // DASHBOARD
  // ================================

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
                Good evening
                {name
                  ? `, ${name}`
                  : ""}{" "}
                👋
              </h1>

              <p>
                Your AI Study Agent has created
                a plan based on your diagnostic
                results.
              </p>

            </div>

            <div className="streak-card">

              <span>
                🔥
              </span>

              <div>

                <strong>
                  {progressData?.student.current_streak ?? 0} day streak
                </strong>

                <small>
                  Keep it going!
                </small>

              </div>

            </div>

          </div>

          <div className="dashboard-grid">
            <section className="dashboard-card">
              <div className="card-heading">
                <div>
                  <small>LEARNING STATS</small>
                  <h2>Real-time progress</h2>
                </div>
              </div>
              {progressLoading ? (
                <p>Loading your progress...</p>
              ) : progressError ? (
                <p>{progressError}</p>
              ) : (
                <div className="plan-grid">
                  <div className="plan-day">
                    <small>ACCURACY</small>
                    <strong>{progressData?.student.accuracy ?? 0}%</strong>
                    <span>{progressData?.student.total_attempts ?? 0} attempts</span>
                  </div>
                  <div className="plan-day">
                    <small>STREAK</small>
                    <strong>🔥 {progressData?.student.current_streak ?? 0}</strong>
                    <span>Best: {progressData?.student.best_streak ?? 0}</span>
                  </div>
                  <div className="plan-day">
                    <small>LEVEL</small>
                    <strong>{progressData?.student.skill_level || "Beginner"}</strong>
                    <span>{progressData?.student.current_difficulty || "easy"} difficulty</span>
                  </div>
                </div>
              )}
            </section>
          </div>

          <section className="agent-decision">

            <div className="agent-avatar large">
              ✦
            </div>

            <div className="decision-content">

              <div className="decision-title">

                <span>
                  AI AGENT DECISION
                </span>

                <small>
                  Just now
                </small>

              </div>

              <h2>
                I've adjusted your learning
                plan.
              </h2>

              <p>
                {progressData?.student.last_recommendation ||
                  "Complete a practice question and I'll analyze your performance to build your personalized plan."}
              </p>

              <div className="decision-tags">

                <span>
                  🎯 {progressData?.topics?.[0]?.topic || "Personalized Priority"}
                </span>

                <span>
                  📈 Adaptive Difficulty
                </span>

                <span>
                  🧠 Personalized
                </span>

              </div>

            </div>

          </section>

          <div className="dashboard-grid">

            <section className="dashboard-card mission-card">

              <div className="card-heading">

                <div>

                  <small>
                    TODAY'S MISSION
                  </small>

                  <h2>
                    {progressData?.topics?.[0]?.topic
                      ? `Build your ${progressData.topics[0].topic} foundation`
                      : "Build your learning foundation"}
                  </h2>

                </div>

                <span className="mission-time">
                  25 min
                </span>

              </div>

              <p className="mission-description">
                {progressData?.student.last_recommendation ||
                  "Start a practice session and your AI Agent will decide what you should practice next."}
              </p>

              <div className="mission-steps">

                <div className="mission-step complete">

                  <span>
                    ✓
                  </span>

                  <div>

                    <strong>
                      Diagnostic analysis
                    </strong>

                    <small>
                      Completed
                    </small>

                  </div>

                </div>

                <div className="mission-step active-step">

                  <span>
                    2
                  </span>

                  <div>

                    <strong>
                      Algebra fundamentals
                    </strong>

                    <small>
                      10 questions
                    </small>

                  </div>

                </div>

                <div className="mission-step">

                  <span>
                    3
                  </span>

                  <div>

                    <strong>
                      Adaptive challenge
                    </strong>

                    <small>
                      AI decides difficulty
                    </small>

                  </div>

                </div>

              </div>

              <button
                className="primary-btn mission-button"
                onClick={startSession}
              >
                Start Today's Mission →
              </button>

            </section>

            <section className="dashboard-card">

              <div className="card-heading">

                <div>

                  <small>
                    YOUR PROGRESS
                  </small>

                  <h2>
                    Skill overview
                  </h2>

                </div>

              </div>

              <div className="dashboard-skill">
                <div>
                  <span>Overall</span>
                  <strong>
                    {progressData?.student.accuracy ?? 0}%
                  </strong>
                </div>

                <div className="dashboard-progress">
                  <span
                    style={{
                      width: `${Math.min(
                        progressData?.student.accuracy ?? 0,
                        100
                      )}%`,
                    }}
                  />
                </div>

                <small>
                  {progressData?.student.skill_level || "No data yet"}
                </small>
              </div>

              {progressData?.topics?.length ? (
                progressData.topics.slice(0, 3).map((topic) => (
                  <div
                    className="dashboard-skill"
                    key={topic.topic}
                  >
                    <div>
                      <span>{topic.topic}</span>
                      <strong>{Math.round(topic.accuracy)}%</strong>
                    </div>

                    <div className="dashboard-progress">
                      <span
                        style={{
                          width: `${Math.min(topic.accuracy, 100)}%`,
                        }}
                      />
                    </div>

                    <small>
                      {topic.accuracy < 60
                        ? "Needs practice"
                        : topic.accuracy < 80
                        ? "Improving"
                        : "Strong"}
                    </small>
                  </div>
                ))
              ) : (
                <p>
                  Complete your first practice question to see topic-level progress.
                </p>
              )}

            </section>

          </div>

          <section className="dashboard-card weekly-plan">

            <div className="card-heading">

              <div>

                <small>
                  AI GENERATED PLAN
                </small>

                <h2>
                  This week's learning path
                </h2>

              </div>

              <span className="plan-badge">
                Personalized
              </span>

            </div>

            <div className="plan-grid">

              {[
                ["MON", "Algebra", "25 min"],
                ["TUE", "Reading", "30 min"],
                ["WED", "Geometry", "25 min"],
                ["THU", "Algebra", "30 min"],
                [
                  "FRI",
                  "Mixed Practice",
                  "40 min",
                ],
                ["SAT", "Mini Test", "45 min"],
              ].map(
                ([day, subject, time], index) => (

                  <div
                    key={day}
                    className={
                      index === 0
                        ? "plan-day today"
                        : "plan-day"
                    }
                  >

                    <small>
                      {day}
                    </small>

                    <strong>
                      {subject}
                    </strong>

                    <span>
                      {time}
                    </span>

                  </div>

                )
              )}

            </div>

          </section>

          <section className="dashboard-card next-action">

            <div className="next-icon">
              ✦
            </div>

            <div>

              <small>
                NEXT ACTION
              </small>

              <h3>
                Ready to improve your Algebra?
              </h3>

              <p>
                Your AI Agent is ready with your
                first adaptive practice session.
              </p>

            </div>

            <button
              className="secondary-btn"
              onClick={startSession}
            >
              Start Practice
            </button>

          </section>

        </main>

      </div>
    );
  }

  // ================================
  // AI SESSION
  // ================================

  if (screen === "session") {
    const question =
      adaptiveQuestions[sessionQuestion];

    const progress =
      ((sessionQuestion + 1) /
        adaptiveQuestions.length) *
      100;

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
                Adaptive Algebra
              </h1>

              <p>
                Your AI Agent is analyzing your
                answers in real time.
              </p>

            </div>

            <div className="session-progress-text">
              Question{" "}
              {sessionQuestion + 1} /{" "}
              {adaptiveQuestions.length}
            </div>

          </div>

          <div className="assessment-progress">

            <div
              style={{
                width: `${progress}%`,
              }}
            />

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
                  {currentDifficulty.toUpperCase()}
                </span>

              </p>

            </div>

          </div>

          <div className="session-question-card">

            <div className="question-meta">

              <span>
                {question.topic}
              </span>

              <span>
                {currentDifficulty}
              </span>

            </div>

            <h2>
              {question.question}
            </h2>

            <div className="answers">

              {question.options.map(
                (option, index) => (

                  <button
                    key={option}
                    className={
                      selectedAnswer === option
                        ? "answer selected-answer"
                        : "answer"
                    }
                    disabled={agentLoading}
                    onClick={() =>
                      submitSessionAnswer(
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

                    {selectedAnswer ===
                      option && (
                      <span className="check">
                        ✓
                      </span>
                    )}

                  </button>

                )
              )}

            </div>

          </div>

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
                  I'm analyzing your answer and
                  deciding what you should practice
                  next.
                </p>

              </div>

            </div>

          )}

          {sessionError && (

            <div className="agent-thinking error-box">

              <div className="agent-avatar">
                !
              </div>

              <div>

                <strong>
                  Connection problem
                </strong>

                <p>
                  {sessionError}
                </p>

              </div>

            </div>

          )}

          {agentResponse &&
            !agentLoading && (

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
                          ? "Excellent work!"
                          : "Let's work on this."}
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
                        : "Review"}
                    </span>

                  </div>

                  <p className="agent-feedback">
                    {agentResponse.feedback}
                  </p>

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
                    onClick={
                      nextSessionQuestion
                    }
                  >

                    {sessionQuestion ===
                    adaptiveQuestions.length - 1
                      ? "See My Results →"
                      : "Continue →"}

                  </button>

                </div>

              </div>
            )}

        </main>

      </div>
    );
  }

  // ================================
  // RESULTS
  // ================================

  if (screen === "results") {
    const percentage = Math.round(
      (sessionScore /
        adaptiveQuestions.length) *
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
            Great work
            {name
              ? `, ${name}`
              : ""}! 🎉
          </h1>

          <p className="results-description">

            Your AI Agent analyzed your performance
            and updated your learning strategy.

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
                Your Algebra performance
              </h3>

              <p>
                Your AI Agent used your answers to
                adjust difficulty and determine
                what you should practice next.
              </p>

            </div>

          </div>

          <div className="agent-result">

            <div className="agent-avatar">
              ✦
            </div>

            <div>

              <small>
                AI AGENT UPDATE
              </small>

              <h3>
                Your learning plan has been
                updated.
              </h3>

              <p>
                I've recorded today's performance.
                I'll use it to decide which topics
                and difficulty levels you should
                practice next.
              </p>

              {agentResponse && (

                <div className="agent-recommendation">

                  <strong>
                    🎯 Next recommendation
                  </strong>

                  <p>
                    {agentResponse.recommendation}
                  </p>

                </div>

              )}

            </div>

          </div>

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
              Back to Dashboard
            </button>

          </div>

        </main>

      </div>
    );
  }

  return null;
}

export default App;