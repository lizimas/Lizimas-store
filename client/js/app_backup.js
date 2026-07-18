const API = "http://127.0.0.1:5000/api";


async function loadProducts(){

    try {

        const response = await fetch(`${API}/products`);

        const products = await response.json();

        console.log(products);

        const container = document.getElementById("products");


        if(container){

            container.innerHTML = "";


            products.forEach(product => {

                container.innerHTML += `

                <div class="card">

                    <img 
                    src="${product.image}"
                    alt="${product.name}"
                    class="product-image">


                    <h3>${product.name}</h3>

                    <p>${product.description || ""}</p>

                    <p>
                    Category: ${product.category || ""}
                    </p>


                    <h3>
                    UGX ${product.price}
                    </h3>


                    <p>
                    Available: ${product.stock}
                    </p>


                    <button onclick="addToCart(
                    '${product.id}',
                    '${product.name}',
                    '${product.price}',
                    '${product.image}'
                    )">

                    Add to Cart

                    </button>


                </div>

                `;

            });


        }


    } catch(error){

        console.log("Error loading products:", error);

    }

}



function addToCart(id,name,price,image){

let cart = JSON.parse(localStorage.getItem("cart")) || [];


cart.push({

id:id,
name:name,
price:price,
image:image,
quantity:1

});


localStorage.setItem(
"cart",
JSON.stringify(cart)
);


alert(name + " added to cart");

}



loadProducts();

function placeOrder(){

let name = document.getElementById("name").value;
let phone = document.getElementById("phone").value;
let address = document.getElementById("address").value;
let payment = document.getElementById("payment").value;


let cart = JSON.parse(localStorage.getItem("cart")) || [];


if(cart.length === 0){

alert("Your cart is empty");
return;

}


if(payment === "Mobile Money"){

alert(
"Please send payment to Mobile Money number:\n\n+256792363104\n\nAfter payment, your order will be processed."
);

}


let order = {

customer_name:name,
phone:phone,
address:address,
payment_method:payment,
items:cart

};


console.log("Order Submitted:", order);


alert(
"Thank you " + name + "!\nYour order has been received."
);


localStorage.removeItem("cart");


window.location.href="index.html";


}
