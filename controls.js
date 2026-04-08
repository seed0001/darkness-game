import * as THREE from 'three';

export class Controls {
    constructor(camera, domElement, character) {
        this.camera = camera;
        this.domElement = domElement;
        this.character = character;
        
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
        this.isSprinting = false;
        
        this.isLocked = false;
        
        this.cameraDistance = 15;
        this.cameraHeight = 8;
        this.cameraAngleX = 0;
        this.cameraAngleY = 0.3;
        
        this.mouseSensitivity = 0.002;
        
        this.speed = 40.0;
        this.sprintMultiplier = 2.5;
        this.walkMultiplier = 0.4;

        this.initEventListeners();
    }

    setCharacter(character) {
        this.character = character;
    }

    initEventListeners() {
        const onKeyDown = (event) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    this.moveForward = true;
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    this.moveLeft = true;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.moveBackward = true;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    this.moveRight = true;
                    break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.isSprinting = true;
                    break;
                case 'Space':
                    if (this.character && this.character.isLoaded) {
                        this.character.tryJump();
                    }
                    break;
            }
        };

        const onKeyUp = (event) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    this.moveForward = false;
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    this.moveLeft = false;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.moveBackward = false;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    this.moveRight = false;
                    break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.isSprinting = false;
                    break;
            }
        };

        const onMouseMove = (event) => {
            if (!this.isLocked) return;
            
            const movementX = event.movementX || 0;
            const movementY = event.movementY || 0;
            
            this.cameraAngleX -= movementX * this.mouseSensitivity;
            this.cameraAngleY += movementY * this.mouseSensitivity;
            
            this.cameraAngleY = Math.max(-0.5, Math.min(1.2, this.cameraAngleY));
        };

        const onPointerLockChange = () => {
            this.isLocked = document.pointerLockElement === this.domElement;
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('pointerlockchange', onPointerLockChange);
    }

    update(delta, terrainManager) {
        if (!this.isLocked || !this.character || !this.character.isLoaded) return;

        if (this.character.isJumpAnimating) {
            this.character.update(delta, terrainManager);
            this.updateCamera();
            return;
        }

        const isMoving = this.moveForward || this.moveBackward || this.moveLeft || this.moveRight;
        
        if (isMoving) {
            let speedMultiplier = this.walkMultiplier;
            let animState = 'walk';
            
            if (this.isSprinting) {
                speedMultiplier = 1.0;
                animState = 'run';
            }
            
            const actualSpeed = this.speed * speedMultiplier;
            
            let moveAngle = this.cameraAngleX;
            
            if (this.moveForward && this.moveLeft) moveAngle += Math.PI / 4;
            else if (this.moveForward && this.moveRight) moveAngle -= Math.PI / 4;
            else if (this.moveBackward && this.moveLeft) moveAngle += Math.PI * 3 / 4;
            else if (this.moveBackward && this.moveRight) moveAngle -= Math.PI * 3 / 4;
            else if (this.moveBackward) moveAngle += Math.PI;
            else if (this.moveLeft) moveAngle += Math.PI / 2;
            else if (this.moveRight) moveAngle -= Math.PI / 2;
            
            const moveX = Math.sin(moveAngle) * actualSpeed * delta;
            const moveZ = Math.cos(moveAngle) * actualSpeed * delta;

            const charPos = this.character.getPosition();
            let nx = charPos.x + moveX;
            let nz = charPos.z + moveZ;
            if (terrainManager && typeof terrainManager.resolveObstacleCollision === 'function') {
                const res = terrainManager.resolveObstacleCollision(nx, nz);
                nx = res.x;
                nz = res.z;
            } else if (terrainManager && typeof terrainManager.resolveBoulderCollision === 'function') {
                const res = terrainManager.resolveBoulderCollision(nx, nz);
                nx = res.x;
                nz = res.z;
            }
            this.character.setPosition(nx, charPos.y, nz);
            
            this.character.setRotation(moveAngle);
            if (this.character.isGrounded) {
                this.character.setState(animState);
            } else if (this.character.animations?.jump) {
                this.character.setState('jump');
            }
        } else {
            if (this.character.isGrounded) {
                this.character.setState('idle');
            } else if (this.character.animations?.jump) {
                this.character.setState('jump');
            }
        }
        
        this.character.update(delta, terrainManager);
        
        this.updateCamera();
    }

    updateCamera() {
        if (!this.character) return;
        
        const charPos = this.character.getPosition();
        
        const horizontalDist = this.cameraDistance * Math.cos(this.cameraAngleY);
        const verticalDist = this.cameraDistance * Math.sin(this.cameraAngleY) + this.cameraHeight;
        
        const camX = charPos.x - Math.sin(this.cameraAngleX) * horizontalDist;
        const camZ = charPos.z - Math.cos(this.cameraAngleX) * horizontalDist;
        const camY = charPos.y + verticalDist;
        
        this.camera.position.set(camX, camY, camZ);
        
        const lookTarget = new THREE.Vector3(
            charPos.x,
            charPos.y + 4,
            charPos.z
        );
        this.camera.lookAt(lookTarget);
    }

    lock() {
        this.domElement.requestPointerLock();
    }

    unlock() {
        document.exitPointerLock();
    }
}
