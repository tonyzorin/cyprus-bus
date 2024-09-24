class Modal {
    constructor(options) {
        this.options = Object.assign({
            content: '',
            closable: true,
            onOpen: () => {},
            onClose: () => {}
        }, options);

        this.modal = null;
        this.overlay = null;
        this.closeButton = null;
        this.isOpen = false;

        this.create();
        this.addEventListeners();
    }

    create() {
        // Create modal elements
        this.overlay = document.createElement('div');
        this.overlay.className = 'modal-overlay';

        this.modal = document.createElement('div');
        this.modal.className = 'modal';
        this.modal.innerHTML = `
            <div class="modal-content">
                ${this.options.content}
                ${this.options.closable ? '<button class="modal-close">&times;</button>' : ''}
            </div>
        `;

        // Add to DOM
        const container = document.getElementById('modalContainer');
        container.appendChild(this.overlay);
        container.appendChild(this.modal);

        if (this.options.closable) {
            this.closeButton = this.modal.querySelector('.modal-close');
        }
    }

    addEventListeners() {
        if (this.options.closable) {
            this.closeButton.addEventListener('click', () => this.close());
            this.overlay.addEventListener('click', () => this.close());
        }

        // Close on Escape key press
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });
    }

    open() {
        if (!this.isOpen) {
            this.overlay.style.display = 'block';
            this.modal.style.display = 'block';
            setTimeout(() => {
                this.overlay.classList.add('active');
                this.modal.classList.add('active');
            }, 10);
            this.isOpen = true;
            this.options.onOpen();
        }
    }

    close() {
        if (this.isOpen) {
            this.overlay.classList.remove('active');
            this.modal.classList.remove('active');
            setTimeout(() => {
                this.overlay.style.display = 'none';
                this.modal.style.display = 'none';
            }, 300);
            this.isOpen = false;
            this.options.onClose();
        }
    }
}

// Usage
document.addEventListener('DOMContentLoaded', () => {
    const shareButton = document.getElementById('share-button');
    const qrModal = new Modal({
        content: `
            <h2>Cyprus Bus on Map</h2>
            <img id="qrCodeImage" class="qr-code-image" src="/images/qr_code.png" alt="QR Code" />
            <button id="native-share-button" class="bg-green-500 text-white px-4 py-2 rounded">Send</button>
        `,
        onOpen: () => {
            console.log('QR modal opened');
            setupNativeShare();
        },
        onClose: () => console.log('QR modal closed')
    });

    shareButton.addEventListener('click', () => qrModal.open());
});

function setupNativeShare() {
    const nativeShareButton = document.getElementById('native-share-button');
    
    if (!nativeShareButton) {
        console.warn('Native share button not found in the DOM');
        return;
    }

    if (navigator.share) {
        nativeShareButton.style.display = 'inline-block';
        nativeShareButton.addEventListener('click', async () => {
            try {
                await navigator.share({
                    title: 'Cyprus Buses on Map',
                    text: 'Check out this cool bus tracking app for Cyprus!',
                    url: window.location.href
                });
                console.log('Content shared successfully');
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Error sharing:', err);
                }
            }
        });
    } else {
        nativeShareButton.style.display = 'none';
    }
}