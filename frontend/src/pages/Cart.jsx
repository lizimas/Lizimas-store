import { useCart } from "../context/CartContext";

function Cart() {

  const {
    cart,
    removeFromCart,
    total
  } = useCart();


  return (
    <div className="cart-page">

      <h1>Your Shopping Cart</h1>


      {cart.length === 0 ? (

        <p>
          Your cart is empty.
        </p>

      ) : (

        <>

          {cart.map(item => (

            <div
              className="cart-item"
              key={item.id}
            >

              <img
                src={`http://localhost:5000/${item.image}`}
                alt={item.name}
              />


              <div>

                <h3>
                  {item.name}
                </h3>

                <p>
                  Quantity: {item.quantity}
                </p>

                <p>
                  UGX {(
                    Number(item.price) *
                    item.quantity
                  ).toLocaleString()}
                </p>


                <button
                  onClick={() =>
                    removeFromCart(item.id)
                  }
                >
                  Remove
                </button>

              </div>

            </div>

          ))}


          <h2>
            Total:
            UGX {total.toLocaleString()}
          </h2>


          <button>
            Proceed to Checkout
          </button>

        </>

      )}

    </div>
  );
}

export default Cart;
