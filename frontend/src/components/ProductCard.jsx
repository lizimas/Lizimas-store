import { useCart } from "../context/CartContext";

function ProductCard({ product }) {

  const { addToCart } = useCart();


  return (

    <div className="product-card">

      <div className="product-image">

        <img
          src={`http://192.168.43.49:5000/${product.image}`}
          alt={product.name}
        />

      </div>


      <div className="product-info">


        <span className="product-category">
          {product.category || "Store Item"}
        </span>


        <h3>
          {product.name}
        </h3>


        <p className="product-price">
          UGX {Number(product.price).toLocaleString()}
        </p>


        <button
          className="add-cart-btn"
          onClick={() => addToCart(product)}
        >
          Add to Cart 🛒
        </button>


      </div>


    </div>

  );

}


export default ProductCard;
