import { OrderId } from "../elements/OrderId";

export interface OrderRepo {
  save(id: OrderId): Promise<void>;
}
