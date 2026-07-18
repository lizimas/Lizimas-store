const API = "http://localhost:5000/api";


async function loadProducts(){

    try {

        const response = await fetch(`${API}/products`);

        const products = await response.json();

        const container = document.getElementById("products");


        if(container){

            container.innerHTML = "";


            products.forEach(product => {

                container.innerHTML += `

                <div class="card">

                    <h3>${product.name}</h3>

                    <p>${product.description}</p>

                    <p>
                    Category: ${product.category}
                    </p>

                    <h3>
                    UGX ${product.price}
                    </h3>

                    <p>
                    Available: ${product.stock}
                    </p>

                    <button onclick="addToCart(${product.id}, '${product.name}', ${product.price})">
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

function addToCart(id,name,price){

let cart = JSON.parse(localStorage.getItem("cart")) || [];

cart.push({
    id:id,
    name:name,
    price:price,
    quantity:1
});

localStorage.setItem(
    "cart",
    JSON.stringify(cart)
);

alert(name + " added to cart");

}
loadProducts();
function loadCart(){

let cart = JSON.parse(localStorage.getItem("cart")) || [];

let container = document.getElementById("cartItems");

let totalBox = document.getElementById("total");


if(container){

container.innerHTML="";

let total = 0;


cart.forEach(item=>{

total += Number(item.price);


container.innerHTML += `

<div class="card">

<h3>${item.name}</h3>

<p>
Price: UGX ${item.price}
</p>

<p>
Quantity: ${item.quantity}
</p>

</div>

`;

});


totalBox.innerHTML = total;


}

}


loadCart();
async function placeOrder(){

    let cart = JSON.parse(localStorage.getItem("cart")) || [];

    let name = document.getElementById("name").value;
    let phone = document.getElementById("phone").value;
    let address = document.getElementById("address").value;
    let payment = document.getElementById("payment").value;


    if(cart.length === 0){
        alert("Your cart is empty");
        return;
    }


    let total = 0;

    cart.forEach(item=>{
        total += Number(item.price);
    });



    try {

        const response = await fetch(`${API}/orders`,{

            method:"POST",

            headers:{
                "Content-Type":"application/json"
            },

            body:JSON.stringify({

                user_id:1,

                total:total,

                payment_method:payment,

                delivery_address:
                address + " | " + name + " | " + phone

            })

        });


        const data = await response.json();


        if(response.ok){

            alert(
            "Order placed successfully! Order ID: "
            + data.order.id
            );


            localStorage.removeItem("cart");


            window.location.href="index.html";

        }else{

            alert(data.message || "Order failed");

        }


    }catch(error){

        console.log(error);

        alert("Server connection error");

    }

}
