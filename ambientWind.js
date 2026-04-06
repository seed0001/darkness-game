import * as THREE from 'three';

const FOREST_AMBIENCE_URL = '/audio/felixblume_forest_ambience.wav';

export class AmbientWind {
    constructor(listener) {
        this.listener = listener;
        this.sound = null;
        this.buffer = null;
        this.loader = new THREE.AudioLoader();
        this.wantsPlay = false;

        this.bufferPromise = this.loader
            .loadAsync(FOREST_AMBIENCE_URL)
            .then((buffer) => {
                this.buffer = buffer;
                if (this.wantsPlay) {
                    this.play();
                }
            })
            .catch((err) => {
                console.warn('Forest wind ambience failed to load:', err);
            });
    }

    beginAfterUserGesture() {
        this.wantsPlay = true;
        if (this.buffer) {
            this.play();
        }
    }

    play() {
        if (!this.listener || !this.buffer) return;
        if (this.sound) {
            if (!this.sound.isPlaying) {
                this.sound.play();
            }
            return;
        }
        this.sound = new THREE.Audio(this.listener);
        this.sound.setBuffer(this.buffer);
        this.sound.setLoop(true);
        this.sound.setVolume(0.32);
        this.sound.play();
    }
}
