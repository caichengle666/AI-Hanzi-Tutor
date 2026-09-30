import { useCallback, useEffect, useRef } from 'react';
import { playAudio } from '../lib/audio.js';

export function useDictationPlayback({ words, idx, idxRef, recognitionRef, voiceURI, setStatus, setShowHint, setHintCount }) {
    const autoPlayRef = useRef(false);
    const timerRef = useRef(null);
    const startTimerRef = useRef(null);
    const hintTimerRef = useRef(null);
    const speakTokenRef = useRef(0);

    const stopEverything = useCallback(() => {
        // 让正在进行的朗读轮次失效，即使 onend 回调稍后才触发也不会继续
        speakTokenRef.current += 1;
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (startTimerRef.current) {
            clearTimeout(startTimerRef.current);
            startTimerRef.current = null;
        }
        if (hintTimerRef.current) {
            clearTimeout(hintTimerRef.current);
            hintTimerRef.current = null;
        }
        if (window.responsiveVoice) window.responsiveVoice.cancel();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }, []);

    const speakLoop = useCallback((text, count, token) => {
        if (token !== speakTokenRef.current) return;
        if (count > 3) {
            setStatus('listening');
            timerRef.current = setTimeout(() => {
                if (token !== speakTokenRef.current) return;
                try {
                    if (recognitionRef.current) recognitionRef.current.start();
                } catch(e) {}
            }, 1000);
            return;
        }

        // 用 onend 链式触发下一遍，而不是固定延时，避免长句被截断
        playAudio(text, voiceURI, 0, 'zh', () => {
            if (token !== speakTokenRef.current) return;
            timerRef.current = setTimeout(() => speakLoop(text, count + 1, token), 600);
        });
    }, [recognitionRef, setStatus, voiceURI]);

    const startPlay = useCallback((wordToPlay) => {
        stopEverything();
        setStatus('playing');
        setShowHint(false);

        const token = speakTokenRef.current;
        let delay = 100;
        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch(e) {}
            delay = 1200;
        }

        startTimerRef.current = setTimeout(() => {
            startTimerRef.current = null;
            speakLoop(wordToPlay || words[idxRef.current], 1, token);
        }, delay);
    }, [idxRef, recognitionRef, setShowHint, setStatus, speakLoop, stopEverything, words]);

    const requestAutoPlay = useCallback(() => {
        autoPlayRef.current = true;
    }, []);

    const toggleHint = useCallback((showHint, hintCount) => {
        if (showHint) {
            setShowHint(false);
            if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
            return;
        }

        setShowHint(true);
        const duration = hintCount === 0 ? 3000 : 1000;
        hintTimerRef.current = setTimeout(() => setShowHint(false), duration);
        setHintCount(count => count + 1);
    }, [setHintCount, setShowHint]);

    useEffect(() => {
        setHintCount(0);
        if (autoPlayRef.current) {
            autoPlayRef.current = false;
            timerRef.current = setTimeout(() => startPlay(words[idx]), 500);
        }
    }, [idx, setHintCount, startPlay, words]);

    return {
        stopEverything,
        startPlay,
        requestAutoPlay,
        toggleHint
    };
}
