import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { loadDictionary } from './dictionary';

const ROWS = 8;
const COLS = 6;
const STORAGE_KEY = 'word-drop-high-score';
const DANGER_DURATION_MS = 3000;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
// Optional REST endpoint and anon key fallbacks (user supplied REST base)
const restUrl = import.meta.env.VITE_SUPABASE_REST_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase: ReturnType<typeof createClient> | null = null;
try {
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
} catch (err) {
  console.error('Failed to initialize Supabase client:', err);
  supabase = null;
}

// Debug logs removed: preserve error handling only

const letterPool = [
  ...'EEEEEEEEEEEEEEEEAAAAAAAIIIIIIIIOOOOOOOOONNNNNNRRRRRRTTTTTTLLLLSSSSUUUUUDDDDDDGGGBBCCMMPPFFHHVVWWYYKJXQZ'
];

const SCRABBLE_VALUES: Record<string, number> = {
  A: 1,
  B: 3,
  C: 3,
  D: 2,
  E: 1,
  F: 4,
  G: 2,
  H: 4,
  I: 1,
  J: 8,
  K: 5,
  L: 1,
  M: 3,
  N: 1,
  O: 1,
  P: 3,
  Q: 10,
  R: 1,
  S: 1,
  T: 1,
  U: 1,
  V: 4,
  W: 4,
  X: 8,
  Y: 4,
  Z: 10
};

// --- Profanity filter setup (lightweight moderation-safe list) ---
// Keep list intentionally small to avoid overblocking common names.
const BAD_WORDS = [
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'slut', 'whore'
];

const LEET_MAP: Record<string, string> = {
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '0': 'o',
  '5': 's',
  '7': 't',
};

const normalizeNickname = (name: string) => {
  if (!name) return '';
  let s = name.toLowerCase();
  // replace leetspeak digits with letters
  s = s.split('').map((ch) => (LEET_MAP[ch] ? LEET_MAP[ch] : ch)).join('');
  // remove spaces and punctuation, keep alphanumerics
  s = s.replace(/[^a-z0-9]/g, '');
  return s;
};

const isNicknameAllowed = (name: string) => {
  const norm = normalizeNickname(name);
  if (!norm) return false;
  for (const bad of BAD_WORDS) {
    if (norm.includes(bad)) return false;
  }
  return true;
};

const lengthMultiplier = (length: number) => {
  if (length >= 7) return 6;
  if (length === 6) return 4;
  if (length === 5) return 2.5;
  if (length === 4) return 1.5;
  return 1;
};

const comboMultiplier = (combo: number) => {
  if (combo >= 4) return 2;
  if (combo === 3) return 1.5;
  if (combo === 2) return 1.25;
  return 1;
};

type Tile = string | null;

type CellPos = {
  row: number;
  col: number;
};

type LeaderboardEntry = {
  name: string;
  score: number;
  created_at: string;
};

const createEmptyBoard = (): Tile[][] =>
  Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));

const cloneBoard = (board: Tile[][]): Tile[][] => board.map((row) => [...row]);

const getTopFreeColumns = (board: Tile[][]) =>
  board[0]
    .map((cell, col) => (cell === null ? col : -1))
    .filter((col) => col >= 0);

const dropTile = (board: Tile[][], col: number, letter: string) => {
  const nextBoard = cloneBoard(board);
  let row = 0;
  while (row + 1 < ROWS && nextBoard[row + 1][col] === null) {
    row += 1;
  }
  nextBoard[row][col] = letter;
  return nextBoard;
};

const applyGravity = (board: Tile[][]) => {
  const nextBoard = cloneBoard(board);
  for (let col = 0; col < COLS; col += 1) {
    const letters: string[] = [];
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      const tile = nextBoard[row][col];
      if (tile) {
        letters.push(tile);
      }
      nextBoard[row][col] = null;
    }
    for (let row = ROWS - 1; row >= 0 && letters.length > 0; row -= 1) {
      nextBoard[row][col] = letters.shift() ?? null;
    }
  }
  return nextBoard;
};

const randomLetter = () => letterPool[Math.floor(Math.random() * letterPool.length)];

const isTopRowFull = (board: Tile[][]) => board[0].every((cell) => cell !== null);

const adjacent = (a: CellPos, b: CellPos) =>
  Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col)) === 1;

const computeScore = (word: string) => {
  const base = [...word].reduce((sum, letter) => sum + (SCRABBLE_VALUES[letter] ?? 0), 0);
  return base * lengthMultiplier(word.length);
};

const createAudioContext = () => {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  return new AudioContext();
};

const playTone = (ctx: AudioContext, frequency: number, duration: number, type: OscillatorType) => {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gainNode.gain.setValueAtTime(0.18, ctx.currentTime);
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
};

const playSuccessSound = (ctx: AudioContext) => {
  playTone(ctx, 440, 0.12, 'triangle');
  playTone(ctx, 580, 0.12, 'sine');
  playTone(ctx, 720, 0.12, 'triangle');
};

const playInvalidSound = (ctx: AudioContext) => {
  playTone(ctx, 220, 0.08, 'sawtooth');
  playTone(ctx, 180, 0.1, 'sawtooth');
};

const playSelectSound = (ctx: AudioContext) => {
  playTone(ctx, 660, 0.06, 'sine');
};

const isValidWord = (word: string, dictionary: Set<string>): boolean => {
  const lower = word.toLowerCase();
  if (dictionary.has(lower)) return true;
  
  // Check plural: if word ends in 'S', also check singular form
  if (lower.endsWith('s') && lower.length > 1) {
    const singular = lower.slice(0, -1);
    if (dictionary.has(singular)) return true;
  }
  
  return false;
};

function App() {
  const [board, setBoard] = useState<Tile[][]>(createEmptyBoard());
  const [selected, setSelected] = useState<CellPos[]>([]);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [leaderboardDetail, setLeaderboardDetail] = useState<string | null>(null);
  const [dictionary, setDictionary] = useState<Set<string> | null>(null);
  const [dictionaryError, setDictionaryError] = useState<string | null>(null);
  const [newScoreIndex, setNewScoreIndex] = useState(-1);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('Player');
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [pendingScore, setPendingScore] = useState<number | null>(null);
  const [longestWord, setLongestWord] = useState('');
  const [highestScoringWord, setHighestScoringWord] = useState('');
  const [highestWordScore, setHighestWordScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [status, setStatus] = useState<'playing' | 'gameover'>('playing');
  const [dangerSecondsLeft, setDangerSecondsLeft] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const lastSuccessTime = useRef(0);
  const [showInfo, setShowInfo] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<CellPos | null>(null);
  const [wordRewardType, setWordRewardType] = useState<'big' | 'huge' | null>(null);
  const [recoveryActive, setRecoveryActive] = useState(false);
  const recoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false); // Use ref to avoid stale closure issues
  const isPointerDownRef = useRef(false); // Track if pointer is currently down
  const didDragRef = useRef(false); // Track if a drag occurred during this pointer session
  const boardRef = useRef(board);
  const scoreRef = useRef(score);
  const statusRef = useRef(status);
  const highScoreAtGameStartRef = useRef(0);
  const dangerActiveRef = useRef(false);
  const dangerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dangerTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const DRAG_THRESHOLD = 8; // pixels required to consider it a drag

  const getAudioContext = () => {
    if (!audioRef.current) {
      audioRef.current = createAudioContext();
    }
    return audioRef.current;
  };

  const selectedWord = useMemo(
    () => selected.map(({ row, col }) => board[row][col]).join('') as string,
    [board, selected]
  );

  const fetchGlobalLeaderboard = async (): Promise<LeaderboardEntry[]> => {
    // Fetch global leaderboard (client then REST) - no debug logs in production
    setLeaderboardError(null);
    setLeaderboardDetail(null);

    // Try Supabase client first
    if (supabase) {
      try {
        const { data, error } = await (supabase as any).from('leaderboard').select('name, score, created_at');
        if (error || !data) {
          // Supabase client fetch failed; falling back to REST (error details logged below)
        } else {
          const entries: LeaderboardEntry[] = (data as any[])
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 10)
            .map((row: any) => ({
              name: typeof row.name === 'string' && row.name.trim() !== '' ? row.name.slice(0, 12) : 'Player',
              score: typeof row.score === 'number' ? row.score : Number(row.score) || 0,
              created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
            }));
          setLeaderboard(entries);
          setLeaderboardError(null);
          return entries;
        }
      } catch (err) {
        // Supabase client threw while fetching; falling back to REST (error details logged below)
      }
    }

    // Fallback to REST endpoint
    try {
      const base = (restUrl || '').replace(/\/$/, '');
      const url = `${base}/leaderboard?select=name,score,created_at&order=score.desc,created_at.asc&limit=10`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (anonKey) {
        headers.apikey = anonKey;
        headers.Authorization = `Bearer ${anonKey}`;
      }
      // Debug logs removed: not logging anonKey presence
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = await res.text();
        console.error('REST leaderboard fetch failed', res.status, text);
        setLeaderboardError('Global leaderboard unavailable');
        setLeaderboardDetail(`REST error ${res.status}: ${text}`);
        setLeaderboard([]);
        return [];
      }
      const data = (await res.json()) as any[];
      const entries: LeaderboardEntry[] = (data || [])
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 10)
        .map((row: any) => ({
          name: typeof row.name === 'string' && row.name.trim() !== '' ? row.name.slice(0, 12) : 'Player',
          score: typeof row.score === 'number' ? row.score : Number(row.score) || 0,
          created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
        }));
      setLeaderboard(entries);
      setLeaderboardError(null);
      return entries;
    } catch (err: any) {
      console.error('REST fetch error', err);
      setLeaderboardError('Global leaderboard unavailable');
      setLeaderboardDetail(err?.message ? String(err.message) : String(err));
      setLeaderboard([]);
      return [];
    }
  };

  const submitScoreToSupabase = async (name: string, score: number) => {
    // Submitting score to Supabase/REST (no debug logging in production)

    const scoreData = { name, score };

    // Try Supabase client first
    if (supabase) {
      try {
        const result = await (supabase as any).from('leaderboard').insert([scoreData]);
        if (result.error) {
          // Supabase client submit failed; falling back to REST (error handled below)
        } else {
          return true;
        }
      } catch (err) {
        // Supabase client threw while submitting; falling back to REST (error handled below)
      }
    }

    // Fallback to REST
    try {
      const base = (restUrl || '').replace(/\/$/, '');
      const url = `${base}/leaderboard`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (anonKey) {
        headers.apikey = anonKey;
        headers.Authorization = `Bearer ${anonKey}`;
      }
      // Request representation may require Prefer header depending on PostgREST settings
      headers.Prefer = 'return=representation';
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(scoreData),
      });
      if (!res.ok) {
        console.error('REST submit failed', res.status, await res.text());
        setLeaderboardError('Global leaderboard unavailable');
        return false;
      }
      return true;
    } catch (err) {
      console.error('REST submit error', err);
      setLeaderboardError('Global leaderboard unavailable');
      return false;
    }
  };

  const prepareGameOver = (finalScore: number) => {
    const lowestScore = leaderboard[leaderboard.length - 1]?.score ?? 0;
    const isPersonalHighScore = finalScore > highScoreAtGameStartRef.current;
    const qualifiesForLeaderboard = leaderboard.length < 10 || finalScore > lowestScore;
    const qualifies = finalScore > 0 && (isPersonalHighScore || qualifiesForLeaderboard);
    if (qualifies) {
      setPendingScore(finalScore);
      setNicknameInput('Player');
      setShowNicknameModal(true);
      setNewScoreIndex(-1);
    } else {
      setShowGameOver(true);
      setNewScoreIndex(-1);
    }
  };

  const clearDangerCountdown = () => {
    if (dangerTimeoutRef.current) {
      clearTimeout(dangerTimeoutRef.current);
      dangerTimeoutRef.current = null;
    }
    if (dangerTickRef.current) {
      clearInterval(dangerTickRef.current);
      dangerTickRef.current = null;
    }
    dangerActiveRef.current = false;
    setDangerSecondsLeft(null);
  };

  const finishGameOver = () => {
    if (statusRef.current === 'gameover') return;
    clearDangerCountdown();
    setStatus('gameover');
    prepareGameOver(scoreRef.current);
  };

  const startDangerCountdown = (boardState: Tile[][]) => {
    if (statusRef.current !== 'playing' || dangerActiveRef.current || !isTopRowFull(boardState)) {
      return;
    }

    dangerActiveRef.current = true;
    const endsAt = Date.now() + DANGER_DURATION_MS;
    setDangerSecondsLeft(Math.ceil(DANGER_DURATION_MS / 1000));

    dangerTickRef.current = window.setInterval(() => {
      const secondsLeft = Math.max(1, Math.ceil((endsAt - Date.now()) / 1000));
      setDangerSecondsLeft(secondsLeft);
    }, 250);

    dangerTimeoutRef.current = window.setTimeout(() => {
      if (isTopRowFull(boardRef.current)) {
        finishGameOver();
      } else {
        clearDangerCountdown();
      }
    }, DANGER_DURATION_MS);
  };

  const handleNicknameSubmit = async () => {
    if (pendingScore === null) return;
    const raw = nicknameInput.trim();
    const name = (raw === '' ? 'Player' : raw.slice(0, 12));
    // validate nickname
    if (name !== 'Player' && !isNicknameAllowed(name)) {
      setNicknameError('Please choose a different nickname.');
      return;
    }
    setNicknameError(null);
    const success = await submitScoreToSupabase(name, pendingScore);
    setPendingScore(null);
    setShowNicknameModal(false);

    if (!success) {
      setShowGameOver(true);
      return;
    }

    const entries = await fetchGlobalLeaderboard();
    const index = entries.findIndex((entry) => entry.score === pendingScore && entry.name === name);
    setNewScoreIndex(index);
    setShowGameOver(true);
  };

  const handleNicknameCancel = () => {
    setPendingScore(null);
    setShowNicknameModal(false);
    setShowGameOver(true);
  };

  useEffect(() => {
    const storedHighScore = window.localStorage.getItem(STORAGE_KEY);
    const storedHighScoreValue = storedHighScore ? Number(storedHighScore) || 0 : 0;
    if (storedHighScore) {
      setHighScore(storedHighScoreValue);
    }
    try {
      fetchGlobalLeaderboard();
    } catch (err) {
      console.error('Error initializing leaderboard:', err);
      setLeaderboard([]);
      setLeaderboardError('Global leaderboard unavailable');
    }
    loadDictionary()
      .then((words) => {
        setDictionary(words);
        setDictionaryError(null);
      })
      .catch((err) => {
        console.error('Error loading dictionary:', err);
        setDictionaryError('Dictionary unavailable');
      });
    startNewGame(storedHighScoreValue);
  }, []);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => clearDangerCountdown, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(highScore));
  }, [highScore]);

  useEffect(() => {
    if (status !== 'playing') return undefined;
    const interval = window.setInterval(() => {
      setBoard((prev) => {
        if (dangerActiveRef.current) {
          return prev;
        }
        const free = getTopFreeColumns(prev);
        if (free.length === 0) {
          startDangerCountdown(prev);
          return prev;
        }
        const next = dropTile(prev, free[Math.floor(Math.random() * free.length)], randomLetter());
        if (isTopRowFull(next)) {
          startDangerCountdown(next);
        }
        return next;
      });
    }, 2000);
    return () => window.clearInterval(interval);
  }, [status]);

  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
    }
  }, [score, highScore]);

  const spawnInitialTiles = (boardState: Tile[][]) => {
    let nextBoard = cloneBoard(boardState);
    for (let i = 0; i < 4; i += 1) {
      const free = getTopFreeColumns(nextBoard);
      if (free.length === 0) break;
      nextBoard = dropTile(nextBoard, free[Math.floor(Math.random() * free.length)], randomLetter());
    }
    return nextBoard;
  };

  const startNewGame = (personalBestAtStart = highScore) => {
    const empty = createEmptyBoard();
    const seeded = spawnInitialTiles(empty);
    highScoreAtGameStartRef.current = personalBestAtStart;
    setBoard(seeded);
    setSelected([]);
    setScore(0);
    setCombo(0);
    setStatus('playing');
    setInvalid(false);
    setHighestScoringWord('');
    setHighestWordScore(0);
    setShowGameOver(false);
    setShowNicknameModal(false);
    setPendingScore(null);
    setNewScoreIndex(-1);
    setWordRewardType(null);
    setRecoveryActive(false);
    clearDangerCountdown();
    if (recoveryTimeoutRef.current) {
      clearTimeout(recoveryTimeoutRef.current);
      recoveryTimeoutRef.current = null;
    }
    lastSuccessTime.current = 0;
  };

  const startSelection = (row: number, col: number) => {
    const currentPos = { row, col };
    const selectedIndex = selected.findIndex((pos) => pos.row === row && pos.col === col);
    const lastSelected = selected[selected.length - 1];

    if (selectedIndex >= 0) {
      setSelected((prev) => prev.slice(0, selectedIndex));
      playSelectSound(getAudioContext());
      return;
    }

    if (selected.length === 0 || !lastSelected || !adjacent(lastSelected, currentPos)) {
      setSelected([currentPos]);
      playSelectSound(getAudioContext());
      return;
    }

    setSelected((prev) => [...prev, currentPos]);
    playSelectSound(getAudioContext());
  };

  const handleBoardClick = (e: React.MouseEvent) => {
    if (status !== 'playing') return;
    const target = e.target as HTMLElement;
    const isEmptyCell = target.classList.contains('empty');
    const isBoardItself = target.classList.contains('board');
    const isInsideTile = target.closest('.cell.tile') !== null;
    if ((isEmptyCell || isBoardItself) && !isInsideTile) {
      setSelected([]);
    }
  };

  const handlePointerDown = (row: number, col: number, e: React.PointerEvent<HTMLButtonElement>) => {
    if (status !== 'playing' || !board[row][col]) return;
    e.preventDefault();
    const target = e.currentTarget;
    if (target.setPointerCapture) {
      target.setPointerCapture(e.pointerId);
    }
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    setDragStartPos({ row, col });
    isPointerDownRef.current = true;
    didDragRef.current = false;
    isDraggingRef.current = false;
    startSelection(row, col);
  };

  const handlePointerEnter = (row: number, col: number, e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isPointerDownRef.current || status !== 'playing' || !board[row][col]) return;
    e.preventDefault();
    const currentPos = { row, col };
    const alreadySelected = selected.some((pos) => pos.row === row && pos.col === col);
    const prevTile = selected[selected.length - 2];

    if (alreadySelected) {
      if (prevTile && prevTile.row === row && prevTile.col === col) {
        setSelected((prev) => prev.slice(0, -1));
        playSelectSound(getAudioContext());
      }
      return;
    }

    const lastSelected = selected[selected.length - 1];
    if (selected.length === 0 || !lastSelected || adjacent(lastSelected, currentPos)) {
      setSelected((prev) => [...prev, currentPos]);
      playSelectSound(getAudioContext());
      isDraggingRef.current = true;
      didDragRef.current = true;
    }
  };

  const handlePointerUp = (row: number | null, col: number | null, e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    if (e.currentTarget.releasePointerCapture) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if not captured
      }
    }
    isPointerDownRef.current = false;
    isDraggingRef.current = false;
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
    setDragStartPos(null);
    pointerStartRef.current = null;
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    if (e.currentTarget.releasePointerCapture) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if not captured
      }
    }
    isPointerDownRef.current = false;
    isDraggingRef.current = false;
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
    setDragStartPos(null);
    pointerStartRef.current = null;
  };

  const handleSubmit = () => {
    if (!dictionary) {
      setInvalid(true);
      window.setTimeout(() => setInvalid(false), 420);
      return;
    }

    const word = selectedWord;
    if (word.length < 3 || !isValidWord(word, dictionary)) {
      setInvalid(true);
      setSelected([]);
      const ctx = getAudioContext();
      playInvalidSound(ctx);
      window.setTimeout(() => setInvalid(false), 420);
      return;
    }

    const ctx = getAudioContext();
    playSuccessSound(ctx);

    setBoard((prev) => {
      const next = cloneBoard(prev);
      selected.forEach(({ row, col }) => {
        next[row][col] = null;
      });
      const gravityBoard = applyGravity(next);
      
      // Recovery mechanic: after 5+ letter words, clear one random extra tile
      // This gives a skill-based second chance when the board is filling up
      let recoveryBoard = gravityBoard;
      if (word.length >= 5 && isTopRowFull(gravityBoard) === false) {
        // Find all non-empty tiles
        const allTiles: CellPos[] = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (recoveryBoard[r][c] !== null) {
              allTiles.push({ row: r, col: c });
            }
          }
        }
        // Clear a random tile if we have tiles to clear
        if (allTiles.length > 0) {
          const randomTile = allTiles[Math.floor(Math.random() * allTiles.length)];
          recoveryBoard[randomTile.row][randomTile.col] = null;
          recoveryBoard = applyGravity(recoveryBoard);
          setRecoveryActive(true);
          if (recoveryTimeoutRef.current) clearTimeout(recoveryTimeoutRef.current);
          recoveryTimeoutRef.current = window.setTimeout(() => setRecoveryActive(false), 600);
        }
      }
      
      if (isTopRowFull(recoveryBoard)) {
        startDangerCountdown(recoveryBoard);
      } else if (dangerActiveRef.current) {
        clearDangerCountdown();
      }
      return recoveryBoard;
    });

    const now = Date.now();
    const nextCombo = now - lastSuccessTime.current <= 5000 ? combo + 1 : 1;
    lastSuccessTime.current = now;
    setCombo(nextCombo);

    const baseScore = computeScore(word);
    const total = Math.round(baseScore * comboMultiplier(nextCombo));
    setScore((prev) => prev + total);
    setLongestWord((prev) => (word.length > prev.length ? word : prev));

    // Track highest scoring word
    if (total > highestWordScore) {
      setHighestScoringWord(word);
      setHighestWordScore(total);
    }

    // Show reward animation for long words
    if (word.length >= 6) {
      setWordRewardType('huge');
    } else if (word.length >= 5) {
      setWordRewardType('big');
    }
    
    window.setTimeout(() => setWordRewardType(null), 1200);
    setSelected([]);
  };

  const handleClear = () => {
    setSelected([]);
    setInvalid(false);
  };

  return (
    <div className="app">
      <div className="title-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={{ margin: 0 }}>Word Drop</h1>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}>
            <div style={{ fontSize: '0.95rem', color: '#d9ebff' }}>Current Score</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#4a90e2' }}>
              {score}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <div style={{ fontSize: '0.95rem', color: '#d9ebff' }}>Personal High Score</div>
          <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#f8fafc' }}>{highScore}</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="secondary" onClick={() => setShowInfo(true)} style={{ padding: '8px', minHeight: 'auto', fontSize: '1.2rem' }}>
              ℹ️
            </button>
            <button className="secondary" onClick={() => startNewGame()}>
              Restart
            </button>
          </div>
        </div>
      </div>

      <div className={`board${invalid ? ' shake' : ''} ${recoveryActive ? 'recovery-flash' : ''}${wordRewardType ? ` reward-${wordRewardType}` : ''}`} onClick={handleBoardClick} onPointerUp={(e) => { if (e.target === e.currentTarget) handlePointerUp(null, null, e); }} onPointerCancel={handlePointerCancel} onPointerMove={(e) => e.preventDefault()}>
        {board.flatMap((row, rowIndex) =>
          row.map((letter, colIndex) => {
            const isSelected = selected.some((pos) => pos.row === rowIndex && pos.col === colIndex);
            const pointValue = letter ? SCRABBLE_VALUES[letter] || 0 : 0;
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                className={`cell ${letter ? 'tile' : 'empty'} ${isSelected ? 'selected' : ''} ${status === 'gameover' ? 'game-over' : ''}`}
                onPointerDown={(e) => handlePointerDown(rowIndex, colIndex, e)}
                onPointerEnter={(e) => handlePointerEnter(rowIndex, colIndex, e)}
                onPointerUp={(e) => { e.stopPropagation(); handlePointerUp(rowIndex, colIndex, e); }}
                onPointerCancel={handlePointerCancel}
                data-row={rowIndex}
                data-col={colIndex}
              >
                <span className="tile-letter">{letter || ''}</span>
                {letter && <span className="tile-points">{pointValue}</span>}
              </button>
            );
          })
        )}
      </div>

      <div className="controls">
        <div className="panel">
          {dangerSecondsLeft !== null && (
            <div className="danger-countdown">
              Clear a word in {dangerSecondsLeft}s
            </div>
          )}
          <div className={`selected-word${invalid ? ' flash' : ''}${wordRewardType ? ' reward-pulse' : ''}`}>
            <p>
              <span className="word-keyword">Word</span>: {selectedWord || (dictionary ? 'Tap tiles' : 'Loading words')}
            </p>
            <p>{selected.length} tile{selected.length === 1 ? '' : 's'}
              {wordRewardType === 'huge' && <span className="reward-badge huge-badge">HUGE!</span>}
              {wordRewardType === 'big' && <span className="reward-badge big-badge">BIG!</span>}
            </p>
          </div>
          {dictionaryError && <div className="dictionary-error">{dictionaryError}</div>}
          <div className="button-row">
            <button className="secondary" onClick={handleClear} disabled={selected.length === 0}>
              Clear
            </button>
            <button className="primary" onClick={handleSubmit} disabled={selected.length < 3 || status !== 'playing' || !dictionary}>
              Submit
            </button>
          </div>
        </div>
      </div>

      {showInfo && (
        <div className="modal-overlay" onClick={() => setShowInfo(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>How to Play</h2>
              <button className="modal-close" onClick={() => setShowInfo(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="info-section">
                <h3>🎯 Objective</h3>
                <p>Tap adjacent tiles to build words, then submit before the board fills from the top!</p>
              </div>

              <div className="info-section">
                <h3>🎮 How to Play</h3>
                <ul>
                  <li>Tap or drag across tiles that are horizontally, vertically, or diagonally adjacent</li>
                  <li>Tap a tile to select it or start a new word</li>
                  <li>Build words of 3+ letters</li>
                  <li>Submit valid words to clear tiles and earn points</li>
                  <li>New tiles fall every 1.7 seconds</li>
                  <li>Game ends when tiles reach the top row</li>
                </ul>
              </div>

              <div className="info-section">
                <h3>🏆 Scoring</h3>
                <div className="scoring-info">
                  <div>
                    <strong>Letter Values:</strong> Scrabble-style points (A=1, B=3, C=3, etc.)
                  </div>
                  <div>
                    <strong>Length Bonus:</strong>
                    <br />• 3 letters = 1x multiplier
                    <br />• 4 letters = 1.5x multiplier
                    <br />• 5 letters = 2.5x multiplier
                    <br />• 6 letters = 4x multiplier
                    <br />• 7+ letters = 6x multiplier
                  </div>
                  <div>
                    <strong>Combo Bonus:</strong>
                    <br />• 1 word = 1x multiplier
                    <br />• 2 words = 1.25x multiplier
                    <br />• 3 words = 1.5x multiplier
                    <br />• 4+ words = 2x multiplier
                    <br />• (within 5 seconds of previous submission)
                  </div>
                </div>
              </div>

              <div className="info-section">
                <h3>🎵 Sounds</h3>
                <p>• Success chime for valid words</p>
                <p>• Error buzz for invalid words</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNicknameModal && (
        <div className="modal-overlay" onClick={handleNicknameCancel}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🏷️ Enter Nickname</h2>
              <button className="modal-close" onClick={handleNicknameCancel}>×</button>
            </div>
            <div className="modal-body">
              <p>Congratulations! Your score qualifies for the global leaderboard.</p>
              <label htmlFor="nickname" className="info-section">
                <strong>Nickname</strong>
                <input
                  id="nickname"
                  className="nickname-input"
                  type="text"
                  value={nicknameInput}
                  maxLength={12}
                  onChange={(e) => setNicknameInput(e.target.value)}
                  placeholder="Player"
                />
              </label>
              <p className="info-section" style={{ marginTop: '8px' }}>
                Keep it short — 12 characters max.
              </p>
              {nicknameError && (
                <div style={{ color: '#ffd2d2', marginTop: '8px' }}>{nicknameError}</div>
              )}
              <div className="button-row">
                <button className="secondary" onClick={handleNicknameCancel}>
                  Cancel
                </button>
                <button className="primary" onClick={handleNicknameSubmit}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showGameOver && (
        <div className="modal-overlay" onClick={() => setShowGameOver(false)}>
          <div className="modal-content game-over-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🎮 Game Over!</h2>
              <button className="modal-close" onClick={() => setShowGameOver(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="game-over-stats">
                <div className="stat-item">
                  <span className="stat-label">Final Score:</span>
                  <span className="stat-value">{score}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Highest Scoring Word:</span>
                  <span className="stat-value">
                    {highestScoringWord ? `${highestScoringWord} (${highestWordScore} pts)` : 'None'}
                  </span>
                </div>
              </div>

              <div className="leaderboard-section">
                <h3>🏆 Global Leaderboard</h3>
                <div className="leaderboard">
                    {leaderboardError ? (
                      <div className="no-scores">
                        <div>Global leaderboard unavailable.</div>
                        {leaderboardDetail && <div style={{ fontSize: '0.85rem', marginTop: '6px' }}>{leaderboardDetail}</div>}
                        <div style={{ marginTop: '8px' }}>
                          <button className="secondary" onClick={() => { setLeaderboardError(null); setLeaderboardDetail(null); fetchGlobalLeaderboard(); }}>Retry leaderboard</button>
                        </div>
                      </div>
                    ) : Array.isArray(leaderboard) && leaderboard.length > 0 ? (
                      leaderboard.map((entry, index) => (
                        <div key={`${entry.score}-${entry.created_at}`} className={`leaderboard-item ${index === newScoreIndex ? 'new-score' : ''}`}>
                          <span className="rank">#{index + 1}</span>
                          <span className="score">{entry.name} — {entry.score.toLocaleString()}</span>
                          {index === newScoreIndex && <span className="new-score-badge">✨</span>}
                        </div>
                      ))
                    ) : (
                      <div className="no-scores">No global scores yet - be the first!</div>
                    )}
                </div>
              </div>

              <div className="modal-actions">
                <button className="primary restart-btn" onClick={() => startNewGame()}>
                  🎯 Play Again
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
