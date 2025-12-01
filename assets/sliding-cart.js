// ============================================
// SHOPIFY SLIDING CART WITH RECOMMENDATIONS
// Plugin completo para carrito deslizante
// Archivo: assets/sliding-cart.js
// ============================================

// Polyfill para closest() en navegadores antiguos
if (!Element.prototype.closest) {
  Element.prototype.closest = function(s) {
    var el = this;
    do {
      if (el.matches && el.matches(s)) return el;
      el = el.parentElement || el.parentNode;
    } while (el !== null && el.nodeType === 1);
    return null;
  };
}

class SlidingCart {
  constructor() {
    this.isOpen = false;
    this.autoCloseTimer = null;
    this.config = window.SlidingCartConfig || {};
    this.autoCloseDelay = this.config.autoCloseDelay || 8000;
    this.recommendations = new Map();
    this.isUserInteracting = false;
    this.interactionTimeout = null;
    
    // Nuevo: Sistema de gestión de recomendaciones
    this.cartRecommendations = new Map(); // Recomendaciones por producto en el carrito
    this.combinedRecommendations = []; // Recomendaciones combinadas del carrito completo
    this.recommendationsHistory = []; // Historial de recomendaciones cargadas
    
    // Nuevo: Sistema de cache para optimizar llamadas API
    this.productCache = new Map(); // Cache de productos para evitar llamadas duplicadas
    this.metafieldsCache = new Map(); // Cache de metafields para evitar verificaciones repetitivas
    this.recommendationsCache = new Map(); // Cache de recomendaciones por producto
    this.cacheCleanupTimer = null; // Timer para limpieza automática del cache
    
    // Configuraciones avanzadas
    this.config.showCartCount = this.config.showCartCount !== false;
    this.config.showCartTotal = this.config.showCartTotal !== false;
    this.config.showProductImages = this.config.showProductImages !== false;
    this.config.showVariantTitles = this.config.showVariantTitles !== false;
    this.config.enableQuantityControls = this.config.enableQuantityControls !== false;
    this.config.enableRemoveButtons = this.config.enableRemoveButtons !== false;
    this.config.showToastNotifications = this.config.showToastNotifications !== false;
    this.config.toastDuration = this.config.toastDuration || 3000;
    this.config.recommendationsSource = this.config.recommendationsSource || 'hybrid';
    this.config.showRecommendationsTitle = this.config.showRecommendationsTitle !== false;
    this.config.recommendationsTitle = this.config.recommendationsTitle || 'También te puede interesar';
    
    // Solo inicializar si está habilitado
    if (this.config.enabled !== false) {
      this.init();
      
      // Configurar limpieza automática del cache cada 5 minutos
      this.cacheCleanupTimer = setInterval(() => {
        this.clearCache();
      }, 5 * 60 * 1000); // 5 minutos
    }
  }

  // Función para formatear precios con separadores de miles y moneda
  formatPrice(priceInCents) {
    const price = priceInCents / 100;
    const currency = this.config.currency || 'COP';
    
    // Formatear con separadores de miles
    const formattedPrice = new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price);
    
    // Añadir la moneda al final
    return `${formattedPrice} ${currency}`;
  }

  init() {
    this.disableThemeCart();
    this.createCartHTML();
    this.bindEvents();
    this.loadRecommendations();
    this.interceptAddToCart();
  }

  // Deshabilitar el carrito del tema
  disableThemeCart() {
    // Remover event listeners del carrito del tema
    const cartButtons = document.querySelectorAll('.header__icon--cart, [data-cart-icon], .cart-icon');
    cartButtons.forEach(button => {
      const newButton = button.cloneNode(true);
      button.parentNode.replaceChild(newButton, button);
    });

    // Deshabilitar cualquier script del carrito del tema
    const themeCartScripts = document.querySelectorAll('script[src*="cart"], script[src*="drawer"]');
    themeCartScripts.forEach(script => {
      if (script.src.includes('cart') || script.src.includes('drawer')) {
        script.remove();
      }
    });

    // Ocultar elementos del carrito del tema
    const themeCartElements = document.querySelectorAll('.drawer.cart-drawer, .cart-drawer__wrapper, #cart-drawer, .cart-notification');
    themeCartElements.forEach(element => {
      element.style.display = 'none';
      element.style.visibility = 'hidden';
      element.style.pointerEvents = 'none';
    });

    // Prevenir que se abra el carrito del tema
    document.addEventListener('click', async (e) => {
      if (e.target.closest('.header__icon--cart, [data-cart-icon], .cart-icon')) {
        e.preventDefault();
        e.stopPropagation();
        await this.showCart(); // Mostrar nuestro carrito en su lugar
        return false;
      }
    }, true);
  }

  // Crear la estructura HTML del carrito deslizante
  createCartHTML() {
    const position = this.config.position || 'right';
    const width = this.config.width || 450;
    const positionClass = position === 'left' ? 'sliding-cart-left' : 'sliding-cart-right';
    
    const cartHTML = `
      <div id="sliding-cart-overlay" class="sliding-cart-overlay">
        <div id="sliding-cart" class="sliding-cart ${positionClass}" style="width: ${width}px;">
          <div class="sliding-cart-header">
            <h3 class="sliding-cart-title">Tu Carrito</h3>
            <button class="sliding-cart-close" aria-label="Cerrar carrito">
              <svg width="24" height="24" viewBox="0 0 24 24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
          
          <div class="sliding-cart-body">
            <div class="sliding-cart-items" id="sliding-cart-items">
              <!-- Los items del carrito se cargan aquí -->
            </div>
            
            ${this.config.showRecommendations !== false ? `
            <div class="sliding-cart-recommendations" id="sliding-cart-recommendations">
              <div class="recommendations-carousel" id="recommendations-carousel">
                <!-- Las recomendaciones se cargan aquí -->
              </div>
            </div>
            ` : ''}
          </div>
          
          <div class="sliding-cart-footer">
            <div class="cart-total" id="cart-total">
              <span class="total-label">Total:</span>
              <span class="total-amount">$0</span>
            </div>
            <button class="checkout-btn" id="checkout-btn">
              Finalizar Compra
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', cartHTML);
    
    // Añadir event listener específico para el botón de cerrar
    const closeButton = document.querySelector('.sliding-cart-close');
    if (closeButton) {
      closeButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hideCart();
      });
    }
  }

  // Interceptar el evento "añadir al carrito"
  interceptAddToCart() {
    // Interceptar formularios de productos
    document.addEventListener('submit', (e) => {
      if (e.target.matches('[action*="/cart/add"]')) {
        e.preventDefault();
        this.handleAddToCart(e.target);
      }
    });

    // Interceptar botones AJAX de añadir al carrito
    document.addEventListener('click', (e) => {
      if (e.target.matches('.btn-add-to-cart, [data-add-to-cart]')) {
        e.preventDefault();
        this.handleAjaxAddToCart(e.target);
      }
    });
  }

  // Manejar añadir al carrito via formulario
  async handleAddToCart(form) {
    try {
      const formData = new FormData(form);
      const variantId = formData.get('id');
      const quantity = parseInt(formData.get('quantity')) || 1;
      
      // Verificar si el producto ya está en el carrito
      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      
      const existingItem = cart.items.find(item => item.variant_id.toString() === variantId.toString());
      
      if (existingItem) {
        // Si ya existe, actualizar cantidad
        const newQuantity = existingItem.quantity + quantity;
        const updateResponse = await fetch('/cart/change.js', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: existingItem.key,
            quantity: newQuantity
          })
        });
        
        if (updateResponse.ok) {
          await this.refreshCart();
          this.showCart();
          this.showToast(`Cantidad actualizada a ${newQuantity}`, 'success');
        } else {
          this.showToast('Error al actualizar cantidad', 'error');
        }
      } else {
        // Si no existe, añadir nuevo producto
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          const product = await response.json();
          await this.refreshCart();
          await this.showCart();
          this.loadProductRecommendations(product.product_id);
          this.showToast('Producto añadido al carrito', 'success');
        } else {
          this.showToast('Error al añadir producto', 'error');
        }
      }
    } catch (error) {
      console.error('Error adding to cart:', error);
      this.showToast('Error al añadir producto', 'error');
    }
  }

  // Manejar añadir al carrito AJAX
  async handleAjaxAddToCart(button) {
    try {
      const productId = button.dataset.productId;
      const variantId = button.dataset.variantId;
      const quantity = parseInt(button.dataset.quantity) || 1;
      
      // Verificar si el producto ya está en el carrito
      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      
      const existingItem = cart.items.find(item => item.variant_id.toString() === variantId.toString());
      
      if (existingItem) {
        // Si ya existe, actualizar cantidad
        const newQuantity = existingItem.quantity + quantity;
        const updateResponse = await fetch('/cart/change.js', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: existingItem.key,
            quantity: newQuantity
          })
        });
        
        if (updateResponse.ok) {
          await this.refreshCart();
          this.showCart();
          this.showToast(`Cantidad actualizada a ${newQuantity}`, 'success');
        } else {
          this.showToast('Error al actualizar cantidad', 'error');
        }
      } else {
        // Si no existe, añadir nuevo producto
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: variantId,
            quantity: quantity
          })
        });

        if (response.ok) {
          await this.refreshCart();
          await this.showCart();
          this.loadProductRecommendations(productId);
          this.showToast('Producto añadido al carrito', 'success');
        } else {
          this.showToast('Error al añadir producto', 'error');
        }
      }
    } catch (error) {
      console.error('Error adding to cart:', error);
      this.showToast('Error al añadir producto', 'error');
    }
  }

  // Mostrar el carrito deslizante
  async showCart() {
    const overlay = document.getElementById('sliding-cart-overlay');
    const cart = document.getElementById('sliding-cart');
    
    if (overlay && cart) {
      overlay.classList.add('active');
      cart.classList.add('active');
      document.body.classList.add('cart-open');
      
      this.isOpen = true;
      this.setAutoClose();
      
      // Inicializar recomendaciones si es la primera vez que se abre
      if (this.combinedRecommendations.length === 0) {
        await this.initializeCartRecommendations();
      }
    }
  }

  // Inicializar recomendaciones del carrito cuando se abre por primera vez
  async initializeCartRecommendations() {
    try {
      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      
      if (cart.items.length > 0) {
        console.log('Inicializando recomendaciones del carrito existente...');
        
        // Cargar recomendaciones para cada producto en el carrito
        for (const item of cart.items) {
          const productId = item.product_id;
          if (!this.cartRecommendations.has(productId)) {
            const productRecommendations = await this.getProductRecommendations(productId);
            this.cartRecommendations.set(productId, productRecommendations);
          }
        }
        
        // Combinar todas las recomendaciones
        await this.combineCartRecommendations();
        this.displayRecommendations(this.combinedRecommendations);
      }
    } catch (error) {
      console.error('Error initializing cart recommendations:', error);
    }
  }

  // Ocultar el carrito
  hideCart() {
    const overlay = document.getElementById('sliding-cart-overlay');
    const cart = document.getElementById('sliding-cart');
    
    if (overlay && cart) {
      overlay.classList.remove('active');
      cart.classList.remove('active');
      document.body.classList.remove('cart-open');
      
      this.isOpen = false;
      this.isUserInteracting = false; // Resetear estado de interacción
      this.clearAutoClose();
      
      // Limpiar timeout de interacción
      if (this.interactionTimeout) {
        clearTimeout(this.interactionTimeout);
        this.interactionTimeout = null;
      }
      
      // Debug: verificar que se cerró correctamente
      console.log('Carrito cerrado correctamente');
    } else {
      console.warn('No se encontraron elementos del carrito para cerrar');
    }
  }

  // Auto-cerrar después de X segundos
  setAutoClose() {
    this.clearAutoClose();
    
    // Solo establecer auto-close si está habilitado y el usuario no está interactuando
    if (this.config.autoCloseEnabled && !this.isUserInteracting) {
      this.autoCloseTimer = setTimeout(() => {
        this.hideCart();
      }, this.autoCloseDelay);
    }
  }

  clearAutoClose() {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
  }

  // Marcar que el usuario está interactuando
  markUserInteraction() {
    this.isUserInteracting = true;
    this.clearAutoClose();
    
    // Resetear el timeout de interacción
    if (this.interactionTimeout) {
      clearTimeout(this.interactionTimeout);
    }
    
    // Marcar como no interactuando después de 2 segundos de inactividad
    this.interactionTimeout = setTimeout(() => {
      this.isUserInteracting = false;
      // Solo establecer auto-close si el carrito sigue abierto
      if (this.isOpen) {
        this.setAutoClose();
      }
    }, 2000);
  }

  // Refrescar contenido del carrito
  async refreshCart() {
    try {
      const response = await fetch('/cart.js');
      const cart = await response.json();
      
      this.updateCartItems(cart.items);
      this.updateCartTotal(cart.total_price);
      
      // Actualizar recomendaciones si hay productos en el carrito
      if (cart.items.length > 0) {
        await this.combineCartRecommendations();
        this.displayRecommendations(this.combinedRecommendations);
      }
    } catch (error) {
      console.error('Error refreshing cart:', error);
    }
  }

  // Actualizar items del carrito
  updateCartItems(items) {
    const container = document.getElementById('sliding-cart-items');
    
    if (items.length === 0) {
      container.innerHTML = '<p class="empty-cart">Tu carrito está vacío</p>';
      return;
    }

    const itemsHTML = items.map(item => `
      <div class="cart-item" data-key="${item.key}">
        <div class="cart-item-image">
          <img src="${item.featured_image.url}" alt="${item.product_title}">
        </div>
        <div class="cart-item-details">
          <div class="cart-item-header">
            <h4 class="cart-item-title">${item.product_title}</h4>
            <button class="remove-item" data-key="${item.key}" aria-label="Eliminar ${item.product_title}" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
          <p class="cart-item-variant">${item.variant_title || ''}</p>
          <div class="cart-item-quantity">
            <button class="qty-btn qty-minus" data-key="${item.key}">-</button>
            <input type="number" value="${item.quantity}" class="qty-input" data-key="${item.key}" data-current-qty="${item.quantity}" min="0">
            <button class="qty-btn qty-plus" data-key="${item.key}">+</button>
          </div>
        </div>
        <div class="cart-item-price">
          <span class="price">${this.formatPrice(item.line_price)}</span>
        </div>
      </div>
    `).join('');

    container.innerHTML = itemsHTML;
    
    // Debug: verificar que los botones de eliminar se crearon correctamente
    const removeButtons = container.querySelectorAll('.remove-item');
    console.log(`Se crearon ${removeButtons.length} botones de eliminar`);
    removeButtons.forEach((btn, index) => {
      console.log(`Botón ${index}:`, {
        key: btn.dataset.key,
        classList: btn.classList.toString(),
        innerHTML: btn.innerHTML
      });
    });
  }

  // Actualizar total del carrito
  updateCartTotal(totalPrice) {
    const totalElement = document.querySelector('#cart-total .total-amount');
    if (totalElement) {
      totalElement.textContent = this.formatPrice(totalPrice);
    }
    
    // Actualizar contador del botón personalizado
    this.updateCustomCartCount();
  }

  // Actualizar contador del carrito personalizado
  updateCustomCartCount() {
    const cartCountElement = document.getElementById('custom-cart-count');
    if (cartCountElement) {
      // Obtener el total de items del carrito
      const cartItems = document.querySelectorAll('#sliding-cart-items .cart-item');
      const totalItems = cartItems.length;
      
      if (totalItems > 0) {
        cartCountElement.textContent = totalItems;
        cartCountElement.classList.remove('hidden');
      } else {
        cartCountElement.classList.add('hidden');
      }
    }
  }

  // Cargar recomendaciones de productos - MEJORADA para múltiples productos
  async loadProductRecommendations(productId) {
    try {
      console.log(`Cargando recomendaciones para producto: ${productId}`);
      
      // Obtener recomendaciones para este producto específico
      const productRecommendations = await this.getProductRecommendations(productId);
      
      // Almacenar las recomendaciones de este producto en el carrito
      this.cartRecommendations.set(productId, productRecommendations);
      
      // Combinar todas las recomendaciones del carrito
      await this.combineCartRecommendations();
      
      // Mostrar las recomendaciones combinadas
      this.displayRecommendations(this.combinedRecommendations);
      
    } catch (error) {
      console.error('Error loading recommendations:', error);
      // Si falla, intentar mostrar recomendaciones existentes
      if (this.combinedRecommendations.length > 0) {
        this.displayRecommendations(this.combinedRecommendations);
      }
    }
  }

  // Obtener recomendaciones para un producto específico
  async getProductRecommendations(productId) {
    try {
      let recommendations = [];
      
      // Determinar qué fuente de recomendaciones usar
      switch (this.config.recommendationsSource) {
        case 'manual':
          recommendations = await this.getManualRecommendations(productId);
          break;
          
        case 'automatic':
          recommendations = await this.getAutomaticRecommendations(productId);
          break;
          
        case 'hybrid':
        default:
          // Primero intentar manuales, luego automáticas
          recommendations = await this.getManualRecommendations(productId);
          if (recommendations.length === 0) {
            recommendations = await this.getAutomaticRecommendations(productId);
          } else if (recommendations.length < this.config.recommendationsLimit) {
            // Complementar con automáticas si no hay suficientes manuales
            const automaticRecs = await this.getAutomaticRecommendations(productId);
            const existingIds = recommendations.map(p => p.id);
            const additionalRecs = automaticRecs.filter(p => !existingIds.includes(p.id));
            recommendations = [...recommendations, ...additionalRecs.slice(0, this.config.recommendationsLimit - recommendations.length)];
          }
          break;
      }
      
      return recommendations;
    } catch (error) {
      console.warn('Error getting product recommendations:', error);
      return [];
    }
  }

  // Combinar recomendaciones de todos los productos en el carrito
  async combineCartRecommendations() {
    try {
      console.log('Combinando recomendaciones del carrito...');
      
      // Obtener todos los productos del carrito
      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      
      let allRecommendations = [];
      let manualRecommendations = [];
      let automaticRecommendations = [];
      
      // Procesar cada producto del carrito
      for (const item of cart.items) {
        const productId = item.product_id;
        const productRecs = this.cartRecommendations.get(productId) || [];
        
        if (productRecs.length > 0) {
          // Separar recomendaciones manuales de automáticas usando cache
          const manualRecs = [];
          const autoRecs = [];
          
          // Verificar metafields una sola vez por producto
          const hasManualMetafields = await this.hasManualMetafields(productId);
          
          // Clasificar recomendaciones basándose en la verificación única
          for (const rec of productRecs) {
            if (hasManualMetafields) {
              manualRecs.push(rec);
            } else {
              autoRecs.push(rec);
            }
          }
          
          manualRecommendations.push(...manualRecs);
          automaticRecommendations.push(...autoRecs);
          
          console.log(`Producto ${item.product_title}: ${manualRecs.length} manuales, ${autoRecs.length} automáticas (metafields: ${hasManualMetafields})`);
        }
      }
      
      // Priorizar recomendaciones manuales
      if (manualRecommendations.length > 0) {
        // Eliminar duplicados de recomendaciones manuales
        const uniqueManualRecs = this.removeDuplicateRecommendations(manualRecommendations);
        allRecommendations = uniqueManualRecs;
        
        console.log(`Recomendaciones manuales únicas: ${allRecommendations.length}`);
        
        // Si no hay suficientes manuales, complementar con automáticas
        if (allRecommendations.length < this.config.recommendationsLimit) {
          const needed = this.config.recommendationsLimit - allRecommendations.length;
          const additionalAutoRecs = this.removeDuplicateRecommendations(automaticRecommendations)
            .filter(rec => !allRecommendations.some(existing => existing.id === rec.id))
            .slice(0, needed);
          
          allRecommendations.push(...additionalAutoRecs);
          console.log(`Complementadas con ${additionalAutoRecs.length} automáticas`);
        }
      } else {
        // Si no hay manuales, usar automáticas
        allRecommendations = this.removeDuplicateRecommendations(automaticRecommendations);
        console.log(`Usando ${allRecommendations.length} recomendaciones automáticas`);
      }
      
      // Filtrar productos excluidos y ordenar por prioridad
      this.combinedRecommendations = this.filterAndSortRecommendations(allRecommendations);
      
      console.log(`Recomendaciones finales combinadas: ${this.combinedRecommendations.length}`);
      
    } catch (error) {
      console.error('Error combining cart recommendations:', error);
      // Fallback: usar recomendaciones del último producto añadido
      const lastProductRecs = Array.from(this.cartRecommendations.values()).pop() || [];
      this.combinedRecommendations = this.filterAndSortRecommendations(lastProductRecs);
    }
  }

  // Verificar si una recomendación es manual (basada en metafields o tags)
  isManualRecommendation(recommendation, sourceProductId) {
    try {
      // Verificar si viene de metafields del producto fuente
      const sourceProduct = Array.from(this.cartRecommendations.keys()).find(id => id === sourceProductId);
      if (sourceProduct) {
        const sourceRecs = this.cartRecommendations.get(sourceProduct);
        if (sourceRecs && sourceRecs.includes(recommendation)) {
          // Verificar si la fuente tiene metafields de recomendaciones
          // Buscar en el historial de metafields para determinar si es manual
          return this.hasManualMetafields(sourceProductId);
        }
      }
      
      // Verificar tags de recomendación
      const tags = recommendation.tags || [];
      return tags.some(tag => tag.startsWith('recommend-with:') || tag.startsWith('recommend-priority:'));
      
    } catch (error) {
      return false;
    }
  }

  // Verificar si un producto tiene metafields de recomendaciones manuales - OPTIMIZADA con cache
  async hasManualMetafields(productId) {
    try {
      // Verificar si ya tenemos la respuesta en cache
      if (this.metafieldsCache.has(productId)) {
        console.log(`Cache hit para metafields del producto ${productId}`);
        return this.metafieldsCache.get(productId);
      }
      
      // Si no está en cache, hacer la llamada API
      console.log(`Verificando metafields del producto ${productId}...`);
      const response = await fetch(`/products/${productId}.js`);
      
      let hasManualMetafields = false;
      
      if (response.ok) {
        const product = await response.json();
        
        // Verificar metafields de recomendaciones
        if (product.metafields && product.metafields.shopify__discovery__product_recommendation) {
          const relatedProducts = product.metafields.shopify__discovery__product_recommendation.related_products;
          hasManualMetafields = relatedProducts && relatedProducts.length > 0;
        }
        
        // Verificar metafields legacy
        if (!hasManualMetafields && product.metafields && product.metafields.sliding_cart) {
          const relatedProducts = product.metafields.sliding_cart.related_products;
          hasManualMetafields = relatedProducts && relatedProducts.length > 0;
        }
        
        // Almacenar en cache
        this.metafieldsCache.set(productId, hasManualMetafields);
        console.log(`Metafields del producto ${productId} almacenados en cache: ${hasManualMetafields}`);
      }
      
      return hasManualMetafields;
    } catch (error) {
      console.warn(`Error verificando metafields del producto ${productId}:`, error);
      // En caso de error, almacenar false en cache para evitar reintentos
      this.metafieldsCache.set(productId, false);
      return false;
    }
  }

  // Eliminar recomendaciones duplicadas
  removeDuplicateRecommendations(recommendations) {
    const seen = new Set();
    return recommendations.filter(rec => {
      if (seen.has(rec.id)) {
        return false;
      }
      seen.add(rec.id);
      return true;
    });
  }

  // Obtener recomendaciones automáticas de Shopify
  async getAutomaticRecommendations(productId) {
    try {
      const limit = this.config.recommendationsLimit || 6;
      const response = await fetch(`/recommendations/products.json?product_id=${productId}&limit=${limit}`);
      const data = await response.json();
      return data.products || [];
    } catch (error) {
      console.warn('Error loading automatic recommendations:', error);
      return [];
    }
  }

  // Obtener recomendaciones configuradas manualmente - OPTIMIZADA con cache
  async getManualRecommendations(productId) {
    try {
      // Verificar cache primero
      if (this.recommendationsCache.has(productId)) {
        console.log(`Cache hit para recomendaciones manuales del producto ${productId}`);
        return this.recommendationsCache.get(productId);
      }
      
      const recommendations = [];
      
      // 1. Verificar metafields del producto actual
      const currentProductResponse = await fetch(`/products/${productId}.js`);
      if (currentProductResponse.ok) {
        const currentProduct = await currentProductResponse.json();
        
        console.log('Producto actual:', currentProduct.title);
        console.log('Metafields disponibles:', currentProduct.metafields);
        
        // Productos relacionados desde el metafield configurado
        if (currentProduct.metafields && currentProduct.metafields.shopify__discovery__product_recommendation) {
          const relatedProducts = currentProduct.metafields.shopify__discovery__product_recommendation.related_products;
          console.log('Productos relacionados encontrados:', relatedProducts);
          
          if (relatedProducts && relatedProducts.length > 0) {
            for (let relatedProductId of relatedProducts) {
              try {
                // Verificar cache de productos relacionados
                let product;
                if (this.productCache.has(relatedProductId)) {
                  product = this.productCache.get(relatedProductId);
                  console.log('Producto recomendado desde cache:', product.title);
                } else {
                  const response = await fetch(`/products/${relatedProductId}.js`);
                  if (response.ok) {
                    product = await response.json();
                    // Almacenar en cache
                    this.productCache.set(relatedProductId, product);
                    console.log('Producto recomendado cargado y cacheado:', product.title);
                  }
                }
                
                if (product) {
                  recommendations.push(product);
                }
              } catch (e) {
                console.warn(`Could not load manual recommendation product ${relatedProductId}:`, e);
              }
            }
          }
        }
        
        // Fallback: buscar en metafields.sliding_cart (para compatibilidad)
        if (recommendations.length === 0 && currentProduct.metafields && currentProduct.metafields.sliding_cart) {
          const relatedProducts = currentProduct.metafields.sliding_cart.related_products;
          if (relatedProducts && relatedProducts.length > 0) {
            for (let relatedProductId of relatedProducts) {
              try {
                // Verificar cache de productos relacionados
                let product;
                if (this.productCache.has(relatedProductId)) {
                  product = this.productCache.get(relatedProductId);
                } else {
                  const response = await fetch(`/products/${relatedProductId}.js`);
                  if (response.ok) {
                    product = await response.json();
                    // Almacenar en cache
                    this.productCache.set(relatedProductId, product);
                  }
                }
                
                if (product) {
                  recommendations.push(product);
                }
              } catch (e) {
                console.warn(`Could not load manual recommendation product ${relatedProductId}`);
              }
            }
          }
        }
      }
      
      // 2. Verificar recomendaciones por tags
      const tagRecommendations = await this.getTagBasedRecommendations(productId);
      recommendations.push(...tagRecommendations);
      
      // 3. Verificar configuración global (fallback)
      if (recommendations.length === 0 && window.currentProduct && window.currentProduct.manualRecommendations) {
        const productIds = window.currentProduct.manualRecommendations;
        for (let id of productIds) {
          try {
            // Verificar cache de productos globales
            let product;
            if (this.productCache.has(id)) {
              product = this.productCache.get(id);
            } else {
              const response = await fetch(`/products/${id}.js`);
              if (response.ok) {
                product = await response.json();
                // Almacenar en cache
                this.productCache.set(id, product);
              }
            }
            
            if (product) {
              recommendations.push(product);
            }
          } catch (e) {
            console.warn(`Could not load manual recommendation product ${id}`);
          }
        }
      }
      
      // Almacenar en cache
      this.recommendationsCache.set(productId, recommendations);
      console.log(`Recomendaciones manuales del producto ${productId} cacheadas: ${recommendations.length}`);
      
      return recommendations;
    } catch (error) {
      console.warn('Error loading manual recommendations:', error);
      // En caso de error, almacenar array vacío en cache para evitar reintentos
      this.recommendationsCache.set(productId, []);
      return [];
    }
  }

  // Obtener recomendaciones basadas en tags - OPTIMIZADA con cache
  async getTagBasedRecommendations(productId) {
    try {
      const recommendations = [];
      
      // Obtener el producto actual para verificar sus tags
      let currentProduct;
      if (this.productCache.has(productId)) {
        currentProduct = this.productCache.get(productId);
        console.log('Producto actual obtenido desde cache para tags');
      } else {
        const currentProductResponse = await fetch(`/products/${productId}.js`);
        if (!currentProductResponse.ok) return recommendations;
        
        currentProduct = await currentProductResponse.json();
        // Almacenar en cache
        this.productCache.set(productId, currentProduct);
      }
      
      const tags = currentProduct.tags || [];
      
      // Buscar tags de recomendación
      for (let tag of tags) {
        if (tag.startsWith('recommend-with:')) {
          const productHandles = tag.replace('recommend-with:', '').split(',');
          for (let handle of productHandles) {
            try {
              const trimmedHandle = handle.trim();
              
              // Verificar cache de productos por handle
              let product;
              if (this.productCache.has(trimmedHandle)) {
                product = this.productCache.get(trimmedHandle);
                console.log('Producto por tag obtenido desde cache:', product.title);
              } else {
                const response = await fetch(`/products/${trimmedHandle}.js`);
                if (response.ok) {
                  product = await response.json();
                  // Almacenar en cache
                  this.productCache.set(trimmedHandle, product);
                  console.log('Producto por tag cargado y cacheado:', product.title);
                }
              }
              
              if (product) {
                recommendations.push(product);
              }
            } catch (e) {
              console.warn(`Could not load tag-based recommendation product ${handle}`);
            }
          }
        }
      }
      
      return recommendations;
    } catch (error) {
      console.warn('Error loading tag-based recommendations:', error);
      return [];
    }
  }

  // Filtrar y ordenar recomendaciones
  filterAndSortRecommendations(recommendations) {
    try {
      // Filtrar productos excluidos
      const filtered = recommendations.filter(product => {
        // Verificar si el producto está excluido de recomendaciones (nuevo namespace)
        if (product.metafields && product.metafields.shopify__discovery__product_recommendation) {
          const exclude = product.metafields.shopify__discovery__product_recommendation.exclude_from_recommendations;
          if (exclude !== undefined) return !exclude;
        }
        
        // Verificar si el producto está excluido de recomendaciones (namespace anterior para compatibilidad)
        if (product.metafields && product.metafields.sliding_cart) {
          const exclude = product.metafields.sliding_cart.exclude_from_recommendations;
          if (exclude !== undefined) return !exclude;
        }
        
        // Verificar tags de exclusión
        const tags = product.tags || [];
        return !tags.includes('no-recommend');
      });
      
      // Ordenar por prioridad
      filtered.sort((a, b) => {
        const priorityA = this.getProductPriority(a);
        const priorityB = this.getProductPriority(b);
        return priorityB - priorityA; // Mayor prioridad primero
      });
      
      // Limitar al número máximo configurado
      return filtered.slice(0, this.config.recommendationsLimit || 6);
    } catch (error) {
      console.warn('Error filtering and sorting recommendations:', error);
      return recommendations.slice(0, this.config.recommendationsLimit || 6);
    }
  }

  // Obtener prioridad de un producto
  getProductPriority(product) {
    try {
      // Prioridad desde metafields (nuevo namespace)
      if (product.metafields && product.metafields.shopify__discovery__product_recommendation) {
        const priority = product.metafields.shopify__discovery__product_recommendation.recommendation_priority;
        if (priority) return parseInt(priority);
      }
      
      // Prioridad desde metafields (namespace anterior para compatibilidad)
      if (product.metafields && product.metafields.sliding_cart) {
        const priority = product.metafields.sliding_cart.recommendation_priority;
        if (priority) return parseInt(priority);
      }
      
      // Prioridad desde tags
      const tags = product.tags || [];
      for (let tag of tags) {
        if (tag.startsWith('recommend-priority:')) {
          const priority = tag.replace('recommend-priority:', '').trim();
          return parseInt(priority) || 0;
        }
      }
      
      return 0; // Prioridad por defecto
    } catch (error) {
      return 0;
    }
  }

  // Mostrar recomendaciones en el carrusel
  displayRecommendations(products) {
    const container = document.getElementById('recommendations-carousel');
    
    if (!products || products.length === 0) {
      container.innerHTML = '<p class="no-recommendations">No hay recomendaciones disponibles</p>';
      return;
    }

    const recommendationsHTML = products.map(product => {
      const defaultVariant = product.variants[0];
      const message = this.getRecommendationMessage(product);
      
      return `
        <div class="recommendation-item" data-product-id="${product.id}">
          ${this.config.showProductImages ? `
            <div class="recommendation-image">
              <img src="${product.featured_image}" alt="${product.title}">
            </div>
          ` : ''}
          <div class="recommendation-details">
            <p class="recommendation-price">${this.formatPrice(defaultVariant.price)}</p>
            ${message ? `<p class="recommendation-message">${message}</p>` : ''}
            <button class="add-recommendation-btn" 
                    data-product-id="${product.id}" 
                    data-variant-id="${defaultVariant.id}">
              Añadir al carrito
            </button>
          </div>
        </div>
      `;
    }).join('');

    const titleHTML = this.config.showRecommendationsTitle ? 
      `<h4 class="recommendations-title">${this.config.recommendationsTitle}</h4>` : '';

    container.innerHTML = `
      ${titleHTML}
      <div class="recommendations-slider">
        ${recommendationsHTML}
      </div>
    `;

    this.initializeCarousel();
  }

  // Obtener mensaje de recomendación personalizado
  getRecommendationMessage(product) {
    try {
      // Mensaje desde metafields (nuevo namespace)
      if (product.metafields && product.metafields.shopify__discovery__product_recommendation) {
        const message = product.metafields.shopify__discovery__product_recommendation.recommendation_message;
        if (message) return message;
      }
      
      // Mensaje desde metafields (namespace anterior para compatibilidad)
      if (product.metafields && product.metafields.sliding_cart) {
        const message = product.metafields.sliding_cart.recommendation_message;
        if (message) return message;
      }
      
      // Mensaje desde tags
      const tags = product.tags || [];
      for (let tag of tags) {
        if (tag.startsWith('recommend-message:')) {
          return tag.replace('recommend-message:', '').trim();
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  // Inicializar carrusel de recomendaciones
  initializeCarousel() {
    const slider = document.querySelector('.recommendations-slider');
    if (!slider) return;

    // Agregar funcionalidad de desplazamiento horizontal
    slider.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        slider.scrollLeft += e.deltaY;
      }
    });
  }

  // Cargar configuraciones de recomendaciones desde metafields
  async loadRecommendations() {
    // Esta función cargaría las configuraciones de recomendaciones
    // desde metafields o un archivo de configuración
    // Por ahora la dejamos preparada para futuras implementaciones
  }

  // Helper function para verificar si un elemento está dentro del carrito
  isInsideCart(element) {
    try {
      return element && element.closest && element.closest('#sliding-cart');
    } catch (error) {
      return false;
    }
  }

  // Bind eventos
  bindEvents() {
    // Cerrar carrito - Mejorado
    document.addEventListener('click', (e) => {
      // Cerrar con el botón X
      if (e.target.closest('.sliding-cart-close')) {
        e.preventDefault();
        e.stopPropagation();
        this.hideCart();
        return false;
      }
      
      // Cerrar haciendo clic en el overlay (fuera del carrito)
      if (e.target.classList.contains('sliding-cart-overlay')) {
        this.hideCart();
        return false;
      }
    });

    // Mejorado: Tracking de interacción del usuario
    document.addEventListener('mouseenter', (e) => {
      if (this.isInsideCart(e.target)) {
        this.markUserInteraction();
      }
    }, true);

    document.addEventListener('mouseleave', (e) => {
      if (this.isInsideCart(e.target) && this.isOpen) {
        // No establecer auto-close inmediatamente, esperar a que termine la interacción
        setTimeout(() => {
          if (!this.isUserInteracting && this.isOpen) {
            this.setAutoClose();
          }
        }, 500);
      }
    }, true);

    // Detectar cualquier interacción dentro del carrito
    document.addEventListener('mousemove', (e) => {
      if (this.isInsideCart(e.target)) {
        this.markUserInteraction();
      }
    }, true);

    document.addEventListener('click', (e) => {
      if (this.isInsideCart(e.target)) {
        this.markUserInteraction();
      }
    }, true);

    document.addEventListener('scroll', (e) => {
      if (this.isInsideCart(e.target)) {
        this.markUserInteraction();
      }
    }, true);

    // Manejar cambios de cantidad
    document.addEventListener('click', (e) => {
      if (e.target.matches('.qty-plus')) {
        this.updateQuantity(e.target.dataset.key, 1);
      } else if (e.target.matches('.qty-minus')) {
        this.updateQuantity(e.target.dataset.key, -1);
      } else if (e.target.matches('.remove-item') || e.target.closest('.remove-item')) {
        const removeButton = e.target.matches('.remove-item') ? e.target : e.target.closest('.remove-item');
        this.removeItem(removeButton.dataset.key);
      }
    });

    // Manejar cambios manuales en el input de cantidad
    document.addEventListener('change', (e) => {
      if (e.target.matches('.qty-input')) {
        const key = e.target.dataset.key;
        const newQty = parseInt(e.target.value) || 0;
        const currentQty = parseInt(e.target.getAttribute('data-current-qty') || '0');
        
        if (newQty !== currentQty) {
          this.updateQuantityDirect(key, newQty);
        }
      }
    });

    // Añadir recomendaciones al carrito
    document.addEventListener('click', (e) => {
      if (e.target.matches('.add-recommendation-btn')) {
        e.preventDefault();
        this.addRecommendationToCart(
          e.target.dataset.productId,
          e.target.dataset.variantId
        );
      }
    });

    // Event listener específico para botones de eliminar (backup)
    document.addEventListener('click', (e) => {
      const removeButton = e.target.closest('.remove-item');
      if (removeButton) {
        e.preventDefault();
        e.stopPropagation();
        const key = removeButton.dataset.key;
        console.log('Botón de eliminar clickeado, key:', key);
        if (key) {
          this.removeItem(key);
        } else {
          console.error('No se encontró data-key en el botón de eliminar');
        }
      }
    });

    // Ir al checkout
    document.addEventListener('click', (e) => {
      if (e.target.matches('#checkout-btn')) {
        const checkoutUrl = this.config.checkoutUrl || '/checkout';
        window.location.href = checkoutUrl;
      }
    });

    // Escape key para cerrar
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.hideCart();
      }
    });
  }

  // Actualizar cantidad de producto (incremento/decremento)
  async updateQuantity(key, change) {
    try {
      // Obtener cantidad actual
      const currentQty = parseInt(document.querySelector(`[data-key="${key}"] .qty-input`).value);
      const newQty = Math.max(0, currentQty + change);
      
      // Si la nueva cantidad es 0, eliminar el item
      if (newQty === 0) {
        this.removeItem(key);
        return;
      }
      
      const response = await fetch('/cart/change.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: key,
          quantity: newQty
        })
      });

      if (response.ok) {
        await this.refreshCart();
        // Mostrar feedback de actualización
        this.showToast(`Cantidad actualizada a ${newQty}`, 'success');
      } else {
        this.showToast('Error al actualizar la cantidad', 'error');
      }
    } catch (error) {
      console.error('Error updating quantity:', error);
      this.showToast('Error al actualizar la cantidad', 'error');
    }
  }

  // Actualizar cantidad de producto directamente (valor específico)
  async updateQuantityDirect(key, newQty) {
    try {
      // Si la nueva cantidad es 0, eliminar el item
      if (newQty === 0) {
        this.removeItem(key);
        return;
      }
      
      const response = await fetch('/cart/change.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: key,
          quantity: newQty
        })
      });

      if (response.ok) {
        await this.refreshCart();
        // Mostrar feedback de actualización
        this.showToast(`Cantidad actualizada a ${newQty}`, 'success');
      } else {
        this.showToast('Error al actualizar la cantidad', 'error');
      }
    } catch (error) {
      console.error('Error updating quantity directly:', error);
      this.showToast('Error al actualizar la cantidad', 'error');
    }
  }

  // Remover item del carrito
  async removeItem(key) {
    try {
      console.log('Intentando eliminar item con key:', key);
      
      // Mostrar feedback antes de eliminar
      this.showRemovedFeedback(key);
      
      const response = await fetch('/cart/change.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: key,
          quantity: 0
        })
      });

      console.log('Respuesta del servidor:', response.status, response.statusText);

      if (response.ok) {
        const result = await response.json();
        console.log('Item eliminado exitosamente:', result);
        
        // Limpiar recomendaciones del producto eliminado
        await this.cleanupRemovedProductRecommendations();
        
        await this.refreshCart();
        // El toast ya se muestra en showRemovedFeedback, no es necesario duplicarlo
      } else {
        const errorText = await response.text();
        console.error('Error del servidor:', errorText);
        this.showToast('Error al eliminar el producto', 'error');
      }
    } catch (error) {
      console.error('Error removing item:', error);
      this.showToast('Error al eliminar el producto', 'error');
    }
  }

  // Limpiar recomendaciones de productos eliminados del carrito
  async cleanupRemovedProductRecommendations() {
    try {
      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      
      // Obtener IDs de productos actualmente en el carrito
      const currentProductIds = new Set(cart.items.map(item => item.product_id));
      
      // Eliminar recomendaciones de productos que ya no están en el carrito
      for (const [productId, recommendations] of this.cartRecommendations.entries()) {
        if (!currentProductIds.has(productId)) {
          console.log(`Limpiando recomendaciones del producto eliminado: ${productId}`);
          this.cartRecommendations.delete(productId);
        }
      }
      
      // Si no hay productos en el carrito, limpiar todo
      if (cart.items.length === 0) {
        this.cartRecommendations.clear();
        this.combinedRecommendations = [];
        console.log('Carrito vacío, limpiando todas las recomendaciones');
      }
      
    } catch (error) {
      console.error('Error cleaning up removed product recommendations:', error);
    }
  }

  // Limpiar cache para liberar memoria
  clearCache() {
    console.log('Limpiando cache de productos y recomendaciones...');
    this.productCache.clear();
    this.metafieldsCache.clear();
    this.recommendationsCache.clear();
    console.log('Cache limpiado exitosamente');
  }

  // Limpiar cache de un producto específico
  clearProductCache(productId) {
    if (this.productCache.has(productId)) {
      this.productCache.delete(productId);
      console.log(`Cache del producto ${productId} limpiado`);
    }
    if (this.metafieldsCache.has(productId)) {
      this.metafieldsCache.delete(productId);
      console.log(`Metafields cache del producto ${productId} limpiado`);
    }
    if (this.recommendationsCache.has(productId)) {
      this.recommendationsCache.delete(productId);
      console.log(`Recomendaciones cache del producto ${productId} limpiado`);
    }
  }

  // Añadir recomendación al carrito
  async addRecommendationToCart(productId, variantId) {
    try {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: variantId,
          quantity: 1
        })
      });

      if (response.ok) {
        await this.refreshCart();
        // Mostrar feedback visual
        this.showAddedFeedback(productId);
      }
    } catch (error) {
      console.error('Error adding recommendation:', error);
    }
  }

  // Mostrar feedback cuando se añade una recomendación
  showAddedFeedback(productId) {
    const item = document.querySelector(`[data-product-id="${productId}"]`);
    const button = item?.querySelector('.add-recommendation-btn');
    
    if (item && button) {
      // Cambiar el texto del botón
      const originalText = button.textContent;
      button.textContent = '✓ Añadido';
      button.classList.add('added');
      
      // Añadir clase al item para efecto visual
      item.classList.add('added-to-cart');
      
      // Mostrar notificación toast
      this.showToast('Producto añadido al carrito', 'success');
      
      // Restaurar después de 3 segundos
      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('added');
        item.classList.remove('added-to-cart');
      }, 3000);
    }
  }

  // Mostrar feedback cuando se elimina un producto
  showRemovedFeedback(itemKey) {
    const item = document.querySelector(`[data-key="${itemKey}"]`);
    
    if (item) {
      // Añadir clase para efecto visual de eliminación
      item.classList.add('removing-item');
      
      // Mostrar notificación toast (solo una vez)
      this.showToast('Producto eliminado del carrito', 'success');
      
      // Remover la clase después de la animación
      setTimeout(() => {
        item.classList.remove('removing-item');
      }, 500);
    }
  }

  // Mostrar notificación toast
  showToast(message, type = 'success', duration = null) {
    // Verificar si las notificaciones están habilitadas
    if (!this.config.showToastNotifications) {
      return;
    }
    
    // Usar duración configurada si no se especifica
    const toastDuration = duration || this.config.toastDuration || 3000;
    
    // Remover toast existente si hay uno
    const existingToast = document.querySelector('.sliding-cart-toast');
    if (existingToast) {
      existingToast.remove();
    }

    // Crear nuevo toast
    const toast = document.createElement('div');
    toast.className = `sliding-cart-toast ${type}`;
    
    // Iconos para diferentes tipos
    const icons = {
      success: '✓',
      error: '✕',
      info: 'ℹ'
    };

    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.success}</span>
      ${message}
    `;

    document.body.appendChild(toast);

    // Mostrar con animación
    setTimeout(() => {
      toast.classList.add('show');
    }, 100);

    // Ocultar automáticamente
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }, toastDuration);
  }
}

// ============================================
// INICIALIZACIÓN
// ============================================

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  window.slidingCart = new SlidingCart();
});

// Para compatibilidad con themes que usan jQuery
if (typeof jQuery !== 'undefined') {
  jQuery(document).ready(() => {
    if (!window.slidingCart) {
      window.slidingCart = new SlidingCart();
    }
  });
}