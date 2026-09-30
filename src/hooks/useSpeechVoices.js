import { useEffect, useState } from 'react';

export function useSpeechVoices(languagePrefix = 'zh') {
    const [voiceList, setVoiceList] = useState([]);

    useEffect(() => {
        const loadVoices = () => {
            const voices = window.speechSynthesis
                .getVoices()
                .filter(voice => voice.lang.includes(languagePrefix));
            setVoiceList(voices);
        };

        loadVoices();
        window.speechSynthesis.addEventListener('voiceschanged', loadVoices);

        return () => {
            window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
        };
    }, [languagePrefix]);

    return voiceList;
}
