import { createContext, useContext, useEffect, useState } from "react";

const CartContext = createContext();

export function CartProvider({ children }) {

  const [cart, setCart] = useState(() => {
    const saved = localStorage.getItem("lizimas-cart");
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem(
      "lizimas-cart",
      JSON.stringify(cart)
    );
  }, [cart]);

  const addToCart = (product) => {

    setCart(current => {

      const existing = current.find(
        item => item.id === product.id
      );

      if (existing) {

        return current.map(item =>
          item.id === product.id
            ? {
                ...item,
                quantity: item.quantity + 1
              }
            : item
        );

      }

      return [
        ...current,
        {
          ...product,
          quantity: 1
        }
      ];

    });

  };

  const increaseQuantity = (id) => {

    setCart(current =>
      current.map(item =>
        item.id === id
          ? {
              ...item,
              quantity: item.quantity + 1
            }
          : item
      )
    );

  };

  const decreaseQuantity = (id) => {

    setCart(current =>
      current
        .map(item =>
          item.id === id
            ? {
                ...item,
                quantity: item.quantity - 1
              }
            : item
        )
        .filter(item => item.quantity > 0)
    );

  };

  const removeFromCart = (id) => {

    setCart(current =>
      current.filter(item => item.id !== id)
    );

  };

  const clearCart = () => {

    setCart([]);

  };

  const totalItems = cart.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const totalPrice = cart.reduce(
    (sum, item) =>
      sum + item.price * item.quantity,
    0
  );

  return (

    <CartContext.Provider
      value={{
        cart,
        addToCart,
        increaseQuantity,
        decreaseQuantity,
        removeFromCart,
        clearCart,
        totalItems,
        totalPrice
      }}
    >

      {children}

    </CartContext.Provider>

  );

}

export function useCart() {

  return useContext(CartContext);

}
