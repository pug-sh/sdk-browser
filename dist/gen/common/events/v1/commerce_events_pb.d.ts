import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file common/events/v1/commerce_events.proto.
 */
export declare const file_common_events_v1_commerce_events: GenFile;
/**
 * @generated from message common.events.v1.ProductViewedProperties
 */
export type ProductViewedProperties = Message<"common.events.v1.ProductViewedProperties"> & {
    /**
     * @generated from field: string product_id = 1;
     */
    productId: string;
    /**
     * @generated from field: string product_name = 2;
     */
    productName: string;
    /**
     * @generated from field: string category = 3;
     */
    category: string;
    /**
     * @generated from field: string brand = 4;
     */
    brand: string;
    /**
     * @generated from field: string sku = 5;
     */
    sku: string;
    /**
     * @generated from field: double price = 6;
     */
    price: number;
    /**
     * @generated from field: string currency = 7;
     */
    currency: string;
};
/**
 * Describes the message common.events.v1.ProductViewedProperties.
 * Use `create(ProductViewedPropertiesSchema)` to create a new message.
 */
export declare const ProductViewedPropertiesSchema: GenMessage<ProductViewedProperties>;
/**
 * A list/category/search-results impression — fired when the user views a
 * collection of products rather than a single product detail page.
 *
 * @generated from message common.events.v1.ProductListViewedProperties
 */
export type ProductListViewedProperties = Message<"common.events.v1.ProductListViewedProperties"> & {
    /**
     * @generated from field: string list_id = 1;
     */
    listId: string;
    /**
     * @generated from field: string list_name = 2;
     */
    listName: string;
    /**
     * @generated from field: string category = 3;
     */
    category: string;
    /**
     * @generated from field: int32 item_count = 4;
     */
    itemCount: number;
};
/**
 * Describes the message common.events.v1.ProductListViewedProperties.
 * Use `create(ProductListViewedPropertiesSchema)` to create a new message.
 */
export declare const ProductListViewedPropertiesSchema: GenMessage<ProductListViewedProperties>;
/**
 * @generated from message common.events.v1.AddToCartProperties
 */
export type AddToCartProperties = Message<"common.events.v1.AddToCartProperties"> & {
    /**
     * @generated from field: string product_id = 1;
     */
    productId: string;
    /**
     * @generated from field: double price = 2;
     */
    price: number;
    /**
     * @generated from field: string currency = 3;
     */
    currency: string;
    /**
     * @generated from field: string cart_id = 4;
     */
    cartId: string;
    /**
     * @generated from field: int32 quantity = 5;
     */
    quantity: number;
    /**
     * @generated from field: string category = 6;
     */
    category: string;
    /**
     * @generated from field: string brand = 7;
     */
    brand: string;
    /**
     * @generated from field: string sku = 8;
     */
    sku: string;
};
/**
 * Describes the message common.events.v1.AddToCartProperties.
 * Use `create(AddToCartPropertiesSchema)` to create a new message.
 */
export declare const AddToCartPropertiesSchema: GenMessage<AddToCartProperties>;
/**
 * @generated from message common.events.v1.RemoveFromCartProperties
 */
export type RemoveFromCartProperties = Message<"common.events.v1.RemoveFromCartProperties"> & {
    /**
     * @generated from field: string product_id = 1;
     */
    productId: string;
    /**
     * @generated from field: double price = 2;
     */
    price: number;
    /**
     * @generated from field: string currency = 3;
     */
    currency: string;
    /**
     * @generated from field: string cart_id = 4;
     */
    cartId: string;
    /**
     * @generated from field: int32 quantity = 5;
     */
    quantity: number;
    /**
     * @generated from field: string category = 6;
     */
    category: string;
    /**
     * @generated from field: string brand = 7;
     */
    brand: string;
    /**
     * @generated from field: string sku = 8;
     */
    sku: string;
};
/**
 * Describes the message common.events.v1.RemoveFromCartProperties.
 * Use `create(RemoveFromCartPropertiesSchema)` to create a new message.
 */
export declare const RemoveFromCartPropertiesSchema: GenMessage<RemoveFromCartProperties>;
/**
 * @generated from message common.events.v1.CartViewedProperties
 */
export type CartViewedProperties = Message<"common.events.v1.CartViewedProperties"> & {
    /**
     * @generated from field: string cart_id = 1;
     */
    cartId: string;
    /**
     * @generated from field: int32 item_count = 2;
     */
    itemCount: number;
    /**
     * @generated from field: double amount = 3;
     */
    amount: number;
    /**
     * @generated from field: string currency = 4;
     */
    currency: string;
};
/**
 * Describes the message common.events.v1.CartViewedProperties.
 * Use `create(CartViewedPropertiesSchema)` to create a new message.
 */
export declare const CartViewedPropertiesSchema: GenMessage<CartViewedProperties>;
/**
 * @generated from message common.events.v1.WishlistAddedProperties
 */
export type WishlistAddedProperties = Message<"common.events.v1.WishlistAddedProperties"> & {
    /**
     * @generated from field: string product_id = 1;
     */
    productId: string;
    /**
     * @generated from field: string wishlist_id = 2;
     */
    wishlistId: string;
    /**
     * @generated from field: double price = 3;
     */
    price: number;
    /**
     * @generated from field: string currency = 4;
     */
    currency: string;
};
/**
 * Describes the message common.events.v1.WishlistAddedProperties.
 * Use `create(WishlistAddedPropertiesSchema)` to create a new message.
 */
export declare const WishlistAddedPropertiesSchema: GenMessage<WishlistAddedProperties>;
/**
 * @generated from message common.events.v1.WishlistRemovedProperties
 */
export type WishlistRemovedProperties = Message<"common.events.v1.WishlistRemovedProperties"> & {
    /**
     * @generated from field: string product_id = 1;
     */
    productId: string;
    /**
     * @generated from field: string wishlist_id = 2;
     */
    wishlistId: string;
};
/**
 * Describes the message common.events.v1.WishlistRemovedProperties.
 * Use `create(WishlistRemovedPropertiesSchema)` to create a new message.
 */
export declare const WishlistRemovedPropertiesSchema: GenMessage<WishlistRemovedProperties>;
/**
 * @generated from message common.events.v1.CouponAppliedProperties
 */
export type CouponAppliedProperties = Message<"common.events.v1.CouponAppliedProperties"> & {
    /**
     * @generated from field: string coupon_id = 1;
     */
    couponId: string;
    /**
     * @generated from field: string coupon_code = 2;
     */
    couponCode: string;
    /**
     * @generated from field: string cart_id = 3;
     */
    cartId: string;
    /**
     * @generated from field: double discount_amount = 4;
     */
    discountAmount: number;
    /**
     * @generated from field: string currency = 5;
     */
    currency: string;
};
/**
 * Describes the message common.events.v1.CouponAppliedProperties.
 * Use `create(CouponAppliedPropertiesSchema)` to create a new message.
 */
export declare const CouponAppliedPropertiesSchema: GenMessage<CouponAppliedProperties>;
/**
 * @generated from message common.events.v1.CouponRemovedProperties
 */
export type CouponRemovedProperties = Message<"common.events.v1.CouponRemovedProperties"> & {
    /**
     * @generated from field: string coupon_id = 1;
     */
    couponId: string;
    /**
     * @generated from field: string coupon_code = 2;
     */
    couponCode: string;
    /**
     * @generated from field: string cart_id = 3;
     */
    cartId: string;
    /**
     * @generated from field: string reason = 4;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.CouponRemovedProperties.
 * Use `create(CouponRemovedPropertiesSchema)` to create a new message.
 */
export declare const CouponRemovedPropertiesSchema: GenMessage<CouponRemovedProperties>;
/**
 * @generated from message common.events.v1.CheckoutStartedProperties
 */
export type CheckoutStartedProperties = Message<"common.events.v1.CheckoutStartedProperties"> & {
    /**
     * @generated from field: string product_id = 1;
     */
    productId: string;
    /**
     * @generated from field: double amount = 2;
     */
    amount: number;
    /**
     * @generated from field: string currency = 3;
     */
    currency: string;
    /**
     * @generated from field: string cart_id = 4;
     */
    cartId: string;
    /**
     * @generated from field: string checkout_id = 5;
     */
    checkoutId: string;
    /**
     * @generated from field: int32 item_count = 6;
     */
    itemCount: number;
};
/**
 * Describes the message common.events.v1.CheckoutStartedProperties.
 * Use `create(CheckoutStartedPropertiesSchema)` to create a new message.
 */
export declare const CheckoutStartedPropertiesSchema: GenMessage<CheckoutStartedProperties>;
/**
 * @generated from message common.events.v1.CheckoutStepCompletedProperties
 */
export type CheckoutStepCompletedProperties = Message<"common.events.v1.CheckoutStepCompletedProperties"> & {
    /**
     * @generated from field: string checkout_id = 1;
     */
    checkoutId: string;
    /**
     * @generated from field: string step = 2;
     */
    step: string;
    /**
     * @generated from field: int32 step_index = 3;
     */
    stepIndex: number;
};
/**
 * Describes the message common.events.v1.CheckoutStepCompletedProperties.
 * Use `create(CheckoutStepCompletedPropertiesSchema)` to create a new message.
 */
export declare const CheckoutStepCompletedPropertiesSchema: GenMessage<CheckoutStepCompletedProperties>;
/**
 * Equivalent to Segment's "Order Completed" event. Fires once per successful
 * order, after payment is confirmed.
 *
 * @generated from message common.events.v1.PurchaseProperties
 */
export type PurchaseProperties = Message<"common.events.v1.PurchaseProperties"> & {
    /**
     * @generated from field: string product_id = 1;
     */
    productId: string;
    /**
     * @generated from field: double amount = 2;
     */
    amount: number;
    /**
     * @generated from field: string currency = 3;
     */
    currency: string;
    /**
     * @generated from field: string order_id = 4;
     */
    orderId: string;
    /**
     * @generated from field: int32 quantity = 5;
     */
    quantity: number;
    /**
     * @generated from field: string category = 6;
     */
    category: string;
    /**
     * @generated from field: string brand = 7;
     */
    brand: string;
    /**
     * @generated from field: string sku = 8;
     */
    sku: string;
};
/**
 * Describes the message common.events.v1.PurchaseProperties.
 * Use `create(PurchasePropertiesSchema)` to create a new message.
 */
export declare const PurchasePropertiesSchema: GenMessage<PurchaseProperties>;
/**
 * @generated from message common.events.v1.OrderRefundedProperties
 */
export type OrderRefundedProperties = Message<"common.events.v1.OrderRefundedProperties"> & {
    /**
     * @generated from field: string order_id = 1;
     */
    orderId: string;
    /**
     * @generated from field: double amount = 2;
     */
    amount: number;
    /**
     * @generated from field: string currency = 3;
     */
    currency: string;
    /**
     * @generated from field: string reason = 4;
     */
    reason: string;
};
/**
 * Describes the message common.events.v1.OrderRefundedProperties.
 * Use `create(OrderRefundedPropertiesSchema)` to create a new message.
 */
export declare const OrderRefundedPropertiesSchema: GenMessage<OrderRefundedProperties>;
